# KML Coordinate Conversion

This repository contains KML coordinate-conversion work, including a small self-contained review build for converting Earth KML coordinates to another spherical target body.

The basic build is located at [`workingBuilds/basic_kml_converter_001`](workingBuilds/basic_kml_converter_001/). It uses Node.js and `@xmldom/xmldom`, with no D3 or project-local runtime dependency.

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
