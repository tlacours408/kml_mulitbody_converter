# KML Coordinate Conversion

This repository contains KML coordinate-conversion work, including a small self-contained review build for converting Earth KML coordinates to another spherical target body.

The basic build is located at [`workingBuilds/basic_kml_converter_001`](workingBuilds/basic_kml_converter_001/). It uses Node.js and `@xmldom/xmldom`, with no D3 or project-local runtime dependency.

## Core conversion rule

The script does not convert Earth coordinates by simply multiplying longitude and latitude by a planet-size ratio. That shortcut would treat degrees like a flat distance and would distort the result.

Instead, the script follows this sequence for each coordinate:

1. It finds the arithmetic mean of all input longitude/latitude tuples. This shared mean becomes the source anchor and target anchor.
2. It projects the Earth longitude and latitude into an X/Y position measured in kilometers.
3. It measures that position relative to the projected Earth anchor. These are the coordinate's local X/Y offsets.
4. It applies those same kilometer offsets around the projected target anchor. The offsets are deliberately not rescaled.
5. It inverse-projects the target X/Y position back into target longitude and latitude.

In other words: the script keeps each point's local projected distance and direction from the anchor, then places that same local shape around the target body. Because the target body has a different radius, the same kilometer distances cover a different number of degrees there. This is the basic size-conversion idea the review script is meant to make easy to inspect.

## Quick start

```powershell
Set-Location 'workingBuilds/basic_kml_converter_001'
npm install

node .\convertEarthKmlToObjectBasic_001.js `
  --input-kml 'D:\path\to\source.kml' `
  --target-object Mars `
  --projection lambertConformalConic `
  --output-kml 'D:\path\to\converted.kml'
```

Use `--target-radius <km>` for a custom target radius. If both `--target-object` and `--target-radius` are supplied, the custom radius takes precedence.

See the [basic build README](workingBuilds/basic_kml_converter_001/README.md) for requirements, supported projections, examples, and limitations.
