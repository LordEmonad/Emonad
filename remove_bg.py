"""
Remove white backgrounds from emoji images and resize for Telegram (100x100)
Uses flood fill from corners to only remove outer background, preserving face whites
"""
from PIL import Image
import os
from collections import deque

input_folder = r"c:\Users\kinga\OneDrive\Documents\Ordtisms\emojis"
output_folder = r"c:\Users\kinga\OneDrive\Documents\Ordtisms\emojis\telegram"

os.makedirs(output_folder, exist_ok=True)

def is_white(pixel, threshold=240):
    """Check if pixel is white/near-white"""
    return pixel[0] > threshold and pixel[1] > threshold and pixel[2] > threshold

def flood_fill_transparent(img, tolerance=15):
    """Flood fill from corners to make outer white background transparent"""
    img = img.convert("RGBA")
    pixels = img.load()
    width, height = img.size
    
    # Track which pixels to make transparent
    to_remove = set()
    visited = set()
    
    # Start flood fill from all 4 corners
    start_points = [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1)]
    
    for start in start_points:
        queue = deque([start])
        
        while queue:
            x, y = queue.popleft()
            
            if (x, y) in visited:
                continue
            if x < 0 or x >= width or y < 0 or y >= height:
                continue
                
            visited.add((x, y))
            pixel = pixels[x, y]
            
            # If this pixel is white/near-white, mark for removal and check neighbors
            if is_white(pixel):
                to_remove.add((x, y))
                # Add 8-directional neighbors
                for dx in [-1, 0, 1]:
                    for dy in [-1, 0, 1]:
                        if dx == 0 and dy == 0:
                            continue
                        queue.append((x + dx, y + dy))
    
    # Make marked pixels transparent
    for x, y in to_remove:
        pixels[x, y] = (255, 255, 255, 0)
    
    return img

for filename in os.listdir(input_folder):
    if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
        input_path = os.path.join(input_folder, filename)
        output_name = os.path.splitext(filename)[0] + '.png'
        output_path = os.path.join(output_folder, output_name)
        
        try:
            # Open image
            img = Image.open(input_path)
            
            # Remove outer white background only (flood fill from corners)
            img = flood_fill_transparent(img)
            
            # Resize to 100x100 for Telegram custom emojis
            img = img.resize((100, 100), Image.LANCZOS)
            
            # Save as PNG with transparency
            img.save(output_path, 'PNG')
            print(f"✓ Processed: {filename} -> {output_name}")
        except Exception as e:
            print(f"✗ Error processing {filename}: {e}")

print(f"\nDone! Check: {output_folder}")
