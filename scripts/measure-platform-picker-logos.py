"""Measure original artwork for uniform picker slots; never modify image pixels."""
import json
import re
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
profiles = (root / 'src/data/platformPickerProfiles.ts').read_text()
layouts = {}
presentation = json.loads((root / 'src/data/platformLogoPresentation.json').read_text())
assets = dict(re.findall(r'"([^"]+)": require\("([^"]+)"\)', profiles))
assets.update(re.findall(r'LOGOS\["([^"]+)"\] = require\("([^"]+)"\)', profiles))
for name, relative in assets.items():
    image = Image.open(root / 'src/data' / relative).convert('RGBA')
    # Transparent/near-white padding is not visible artwork on a property card.
    # Measuring alpha alone made small wordmarks shrink inside their exported white canvas.
    monochrome = name in presentation['monochrome']
    ink = Image.new('L', image.size)
    ink.putdata([255 if a > 96 and (monochrome or (255 - min(r, g, b)) * a / 255 > 48) else 0
                 for r, g, b, a in image.get_flattened_data()])
    bounds = ink.getbbox()
    if not bounds:
        raise ValueError(f'{name}: empty artwork')
    # A measured viewport can omit a decorative header pattern without altering the artwork.
    left, top, right, bottom = presentation['crops'].get(name, bounds)
    width, height = right - left, bottom - top
    scale = min(88 / width, 40 / height)
    layouts[name] = {
        'width': round(image.width * scale, 2), 'height': round(image.height * scale, 2),
        'left': round((96 - width * scale) / 2 - left * scale, 2),
        'top': round((48 - height * scale) / 2 - top * scale, 2),
        'visibleWidth': round(width * scale, 2), 'visibleHeight': round(height * scale, 2),
        # Only explicitly reviewed white-only marks adapt their ink to the surface.
        'monochrome': monochrome,
    }
records = ',\n'.join('  ' + json.dumps(name, ensure_ascii=False) + ': ' + json.dumps(layout, separators=(',', ':')) for name, layout in layouts.items())
(root / 'src/data/platformPickerLogoLayout.json').write_text('{\n' + records + '\n}\n')
print(f'Measured {len(layouts)} original logos: original-color logos inside equal 96×48px slots.')
