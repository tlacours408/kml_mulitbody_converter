# Basic KML Converter

`convertEarthKmlToObjectBasic_001.js` is a small, self-contained Node.js script that demonstrates the core Earth-to-object KML conversion logic.

It reads one KML file, converts every `<coordinates>` element with one of four spherical map projections, and writes one converted KML file. Earth coordinates are projected into kilometer offsets; those offsets are applied unchanged around the target anchor and then inverse-projected using the target radius.

This is a review and teaching script. It is not a batch tool, GUI, or replacement for the larger production converter.

## Requirements

- Node.js 14.6 or newer
- npm

The only runtime dependency is `@xmldom/xmldom`.

## Setup

From this directory:

```powershell
npm install
```

## Run the converter

Use named flags so each value is explicit:

```powershell
node .\convertEarthKmlToObjectBasic_001.js `
  --input-kml 'D:\path\to\source.kml' `
  --target-object Mars `
  --projection lambertConformalConic `
  --output-kml 'D:\path\to\converted.kml'
```

The required flags are:

- `--input-kml`: source KML path
- `--projection`: `albers`, `azimuthalEquidistant`, `lambertAzimuthalEqualArea`, or `lambertConformalConic`
- `--output-kml`: output KML path; it must differ from the input path

Provide either `--target-object` or `--target-radius`:

- `--target-object`: named target such as `Mars`, `Earth`, or `Moon`
- `--target-radius`: custom target radius in kilometers

If both target flags are supplied, `--target-radius` takes precedence:

```powershell
node .\convertEarthKmlToObjectBasic_001.js `
  --input-kml 'D:\path\to\source.kml' `
  --target-object Mars `
  --target-radius 5000 `
  --projection albers `
  --output-kml 'D:\path\to\converted.kml'
```

On success, the script prints one `PASS:` summary with the tuple count, target or radius, projection, and output path. Invalid arguments, malformed KML, invalid coordinates, and invalid projection defaults print `FAIL:` and exit with code `1`.

## Scope and limitations

- One input file and one output file per run.
- All coordinate altitudes are written as `0` in the output.
- The anchor is the literal arithmetic mean of parsed longitude/latitude tuples, including repeated closing tuples.
- The model uses spherical projection equations and unchanged kilometer offsets; it is intended for inspection and validation of the basic conversion logic.
