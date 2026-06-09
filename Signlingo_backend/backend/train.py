import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from dataset import SignLanguageDataset, FEATURE_DIM
from tqdm import tqdm


class SignLanguageModel(nn.Module):
    def __init__(self, input_size, hidden_size, num_classes, num_layers=3):
        super(SignLanguageModel, self).__init__()

        self.projection = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.LayerNorm(hidden_size),
            nn.ReLU(),
            nn.Dropout(0.3),
        )

        self.lstm = nn.LSTM(
            hidden_size, hidden_size // 2, num_layers,
            batch_first=True, bidirectional=True, dropout=0.3)
        self.lstm_norm = nn.LayerNorm(hidden_size)

        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_size, num_heads=8, batch_first=True, dropout=0.3)
        self.attn_norm = nn.LayerNorm(hidden_size)

        self.fc = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_size // 2, num_classes),
        )

    def forward(self, x):
        x = self.projection(x)
        out, _ = self.lstm(x)
        out = self.lstm_norm(out)
        
        attn_out, _ = self.attention(out, out, out)
        out = self.attn_norm(out + attn_out)
        
        out = torch.mean(out, dim=1)
        return self.fc(out)


def train_model(model, dataloader, num_epochs=30, learning_rate=0.001):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Training on: {device}")
    model = model.to(device)

    checkpoint_path = 'sign_model.pth'
    start_epoch = 0

    if os.path.exists(checkpoint_path):
        try:
            ckpt = torch.load(checkpoint_path, map_location=device)
            model.load_state_dict(ckpt['model_state_dict'])
            start_epoch = ckpt.get('epoch', 0)
            print(f"Resumed from epoch {start_epoch}")
        except Exception as e:
            print(f"Starting fresh: {e}")

    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.01)
    scheduler = optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=learning_rate,
        steps_per_epoch=len(dataloader),
        epochs=num_epochs - start_epoch)

    best_acc = 0.0
    for epoch in range(start_epoch, num_epochs):
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0

        pbar = tqdm(enumerate(dataloader), total=len(dataloader),
                     desc=f"Epoch {epoch+1}/{num_epochs}")
        for i, (inputs, labels) in pbar:
            inputs, labels = inputs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            scheduler.step()

            running_loss += loss.item()
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            pbar.set_postfix({
                'loss': f'{loss.item():.4f}',
                'acc': f'{100*correct/total:.1f}%',
            })

        epoch_acc = 100 * correct / total
        avg_loss = running_loss / len(dataloader)
        lr = optimizer.param_groups[0]['lr']
        print(f'Epoch [{epoch+1}/{num_epochs}] Loss: {avg_loss:.4f}, '
              f'Acc: {epoch_acc:.2f}%, LR: {lr:.6f}')

        torch.save({
            'epoch': epoch + 1,
            'model_state_dict': model.state_dict(),
            'num_classes': model.fc[-1].out_features,
            'input_size': FEATURE_DIM,
            'hidden_size': 512,
        }, checkpoint_path)

        if epoch_acc > best_acc:
            best_acc = epoch_acc
            torch.save({
                'epoch': epoch + 1,
                'model_state_dict': model.state_dict(),
                'num_classes': model.fc[-1].out_features,
                'input_size': FEATURE_DIM,
                'hidden_size': 512,
            }, 'sign_model_best.pth')
            print(f"  ★ New best accuracy: {best_acc:.2f}%")

    print(f"Training finished! Best accuracy: {best_acc:.2f}%")
    return model


if __name__ == '__main__':
    BACKEND_DIR = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\backend"

    INPUT_SIZE = FEATURE_DIM  # 100 (normalized)
    HIDDEN_SIZE = 512

    dataset = SignLanguageDataset(BACKEND_DIR, augment=True)

    if len(dataset) == 0:
        print("Dataset is empty!")
    else:
        # Lower num_workers or remove persistent_workers if memory issues occur with memmap
        dataloader = DataLoader(dataset, batch_size=128, shuffle=True,
                                num_workers=2)
        NUM_CLASSES = len(dataset.word_to_idx)
        print(f"Classes: {NUM_CLASSES}, Samples: {len(dataset)}, Features: {INPUT_SIZE}")

        model = SignLanguageModel(INPUT_SIZE, HIDDEN_SIZE, NUM_CLASSES)
        total_params = sum(p.numel() for p in model.parameters())
        print(f"Model parameters: {total_params:,}")

        model = train_model(model, dataloader, num_epochs=30, learning_rate=0.002)
        print("Done!")
