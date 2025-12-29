"""
Resize images to 100x100 for Telegram custom emojis
"""
from PIL import Image
import os

input_folder = r"c:\Users\kinga\OneDrive\Documents\Ordtisms\attachments (2)"
output_folder = r"c:\Users\kinga\OneDrive\Documents\Ordtisms\attachments (2)\telegram"

os.makedirs(output_folder, exist_ok=True)

for filename in os.listdir(input_folder):
    if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
        input_path = os.path.join(input_folder, filename)
        output_path = os.path.join(output_folder, filename)
        
        try:
            img = Image.open(input_path)
            
            # Convert to RGBA to preserve transparency
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            
            # Resize to 100x100 for Telegram custom emojis
            img = img.resize((100, 100), Image.LANCZOS)
            
            # Save as PNG
            img.save(output_path, 'PNG')
            print(f"✓ Resized: {filename}")
        except Exception as e:
            print(f"✗ Error: {filename} - {e}")

print(f"\nDone! Check: {output_folder}")
