# App icons

`icons/<channel>/` is the source of truth. `script/copy-icons.ts` copies the
selected channel's set into `resources/icons` on every build and every pack, so
anything edited directly in `resources/icons` is overwritten.

## Regenerating

The whole set — `icon.ico`, `icon.icns`, the flat PNGs and the Windows Store
logos — is drawn from one geometry in `tools/pack-icons.ps1`
(`C:\Users\MARL\AppData\Local\Temp\oliviacode-dev\pack-icons.ps1` on the build
machine) and written to all three channel folders at once:

```
powershell -ExecutionPolicy Bypass -File pack-icons.ps1
```

Edit the eye positions and radii in `New-IconBitmap` there, not in the PNGs.

Frames are authored on a 1024-unit grid: a 896-unit rounded tile at 64,64 with
a 200-unit corner radius and a violet hairline rim, carrying the owl mark from
`packages/app/src/shell/olivia/owl.tsx` (silhouette `#1a1333`, facets `#241a4d`
and `#150f28`, a `#9a6bff`→`#5b2bd9` brow, a `#8b63ff` beak and `#f4f1ff` eyes)
over an `#0b0a10` tile. At 24px and below the facets are dropped and only the
two eye chevrons are drawn, because the full mark turns to mush at that size.

## Formats

- `icon.ico` — 16/24/32/48/64/128/256, every frame an uncompressed 32bpp DIB.
  PNG-compressed frames are only readable by the Vista+ shell, not by GDI+,
  rcedit's older paths or NSIS, so the packer never emits them.
- `icon.icns` — `icp4`/`icp5`/`icp6`/`ic07`/`ic08`/`ic09`/`ic10`, each a PNG
  rendered at that exact size rather than a downscale of the 1024px one, so the
  smaller sizes keep clean premultiplied alpha. Unpremultiplied anti-aliased
  edges render as a halo on dark backgrounds, most visibly at the 64px size
  macOS uses in System Settings lists.
- `dock.png` — 512px PNG for unpackaged Electron on macOS, where
  `app.dock.setIcon()` cannot take an ICNS.

The Android and iOS folders under each channel are upstream artifacts from the
Tauri era and are not read by the desktop build.
