"""Measure original artwork for uniform picker slots; never modify image pixels."""
import json
import re
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
profiles = (root / 'src/data/platformPickerProfiles.ts').read_text()
layouts = {}
assets = dict(re.findall(r'"([^"]+)": require\("([^"]+)"\)', profiles))
assets.update(re.findall(r'LOGOS\["([^"]+)"\] = require\("([^"]+)"\)', profiles))
for name, relative in assets.items():
    image = Image.open(root / 'src/data' / relative).convert('RGBA')
    bounds = image.getchannel('A').point(lambda value: 255 if value > 32 else 0).getbbox()
    if not bounds:
        raise ValueError(f'{name}: empty artwork')
    left, top, right, bottom = bounds
    width, height = right - left, bottom - top
    scale = min(88 / width, 40 / height)
    pixels = [pixel for pixel in image.get_flattened_data() if pixel[3] > 128]
    light = sum(min(pixel[:3]) > 205 for pixel in pixels) / max(1, len(pixels))
    layouts[name] = {
        'width': round(image.width * scale, 2), 'height': round(image.height * scale, 2),
        'left': round((96 - width * scale) / 2 - left * scale, 2),
        'top': round((48 - height * scale) / 2 - top * scale, 2),
        'visibleWidth': round(width * scale, 2), 'visibleHeight': round(height * scale, 2),
        'dark': light > 0.75,
    }
records = ',\n'.join('  ' + json.dumps(name, ensure_ascii=False) + ': ' + json.dumps(layout, separators=(',', ':')) for name, layout in layouts.items())
(root / 'src/data/platformPickerLogoLayout.json').write_text('{\n' + records + '\n}\n')
print(f'Measured {len(layouts)} original logos: original-color logos inside equal 96×48px slots.')
