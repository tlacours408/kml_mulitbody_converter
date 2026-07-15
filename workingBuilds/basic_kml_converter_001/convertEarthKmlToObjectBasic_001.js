'use strict';

var fs = require('fs');
var path = require('path');
var DOMParser = require('@xmldom/xmldom').DOMParser;
var XMLSerializer = require('@xmldom/xmldom').XMLSerializer;


/*
convertEarthKmlToObjectBasic_001.js

Core conversion rule:

Earth longitude/latitude values are not multiplied by a radius ratio. The
script forward-projects Earth coordinates into kilometer
X/Y values, subtract the projected Earth anchor, apply those unchanged
kilometer offsets around the target anchor, and inverse-project with the
target radius.
*/

/* One authoritative spherical Earth radius for both source Earth space and a named Earth target. */
var earthRadiusKm = 6371.0088;

var targetObjects = [
	{
		key: 'sun',
		name: 'Sun',
		radiusKm: 696000
	},
	{
		key: 'mercury',
		name: 'Mercury',
		radiusKm: 2439.4
	},
	{
		key: 'venus',
		name: 'Venus',
		radiusKm: 6051.8
	},
	{
		key: 'earth',
		name: 'Earth',
		radiusKm: earthRadiusKm
	},
	{
		key: 'moon',
		name: 'Moon',
		radiusKm: 1737.4
	},
	{
		key: 'mars',
		name: 'Mars',
		radiusKm: 3389.5
	},
	{
		key: 'jupiter',
		name: 'Jupiter',
		radiusKm: 69911
	},
	{
		key: 'saturn',
		name: 'Saturn',
		radiusKm: 58232
	},
	{
		key: 'uranus',
		name: 'Uranus',
		radiusKm: 25362
	},
	{
		key: 'neptune',
		name: 'Neptune',
		radiusKm: 24622
	},
	{
		key: 'pluto',
		name: 'Pluto',
		radiusKm: 1188.3
	}
];

/* The named Earth target uses earthRadiusKm so Earth-to-Earth keeps one radius. */

/*
CLI contract:

node convertEarthKmlToObjectBasic_001.js --input-kml <path> --target-object <name> --target-radius <km> --projection <name> --output-kml <path>

Required flags are --input-kml, --projection, and --output-kml. Supply either
--target-object or --target-radius. When both target flags are present,
--target-radius takes precedence.
*/

var supportedProjectionNames = [
	'albers',
	'azimuthalEquidistant',
	'lambertAzimuthalEqualArea',
	'lambertConformalConic'
];

/* Converts input degrees to the radians used by every projection equation. */
function degreesToRadians(degreeValue) {
	return degreeValue * (Math.PI / 180);
}

/* Converts inverse-projection radians back to output degrees. */
function radiansToDegrees(radianValue) {
	return radianValue * (180 / Math.PI);
}

/* Wraps source longitude deltas around the selected projection meridian. */
function normalizeLongitudeRadiansForCentralMeridian(longitudeRadians, centralMeridianRadians) {
	var longitudeDeltaRadians;

	longitudeDeltaRadians = longitudeRadians - centralMeridianRadians;

	while (longitudeDeltaRadians > Math.PI) {
		longitudeDeltaRadians -= Math.PI * 2;
	}

	while (longitudeDeltaRadians < -Math.PI) {
		longitudeDeltaRadians += Math.PI * 2;
	}

	return centralMeridianRadians + longitudeDeltaRadians;
}

/* Guards inverse trigonometric inputs against small floating-point drift. */
function clampUnitValue(value, valueLabel) {
	if (value > 1 && value < 1 + 1e-12) {
		return 1;
	}

	if (value < -1 && value > -1 - 1e-12) {
		return -1;
	}

	if (value < -1 || value > 1 || !Number.isFinite(value)) {
		throw new Error('Invalid ' + valueLabel + ' value: ' + value + '.');
	}

	return value;
}

/* Builds the explicit spherical Albers forward/inverse pair used by the CLI. */
function createAlbersProjection(projectionOptions) {
	var phi1;
	var phi2;
	var phi0;
	var lambda0;
	var radiusKm;
	var n;
	var cValue;
	var rho0Term;
	var rho0;

	phi1 = degreesToRadians(projectionOptions.standardParallelOne);
	phi2 = degreesToRadians(projectionOptions.standardParallelTwo);
	phi0 = degreesToRadians(projectionOptions.latitudeOfOrigin);
	lambda0 = degreesToRadians(projectionOptions.centralMeridian);
	radiusKm = projectionOptions.radiusKm;
	n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));

	if (!Number.isFinite(n) || n === 0) {
		throw new Error('Invalid Albers projection constant n.');
	}

	cValue = (Math.cos(phi1) * Math.cos(phi1)) + (2 * n * Math.sin(phi1));
	rho0Term = cValue - (2 * n * Math.sin(phi0));

	if (rho0Term < 0 || !Number.isFinite(rho0Term)) {
		throw new Error('Invalid Albers projection constant rho0.');
	}

	rho0 = radiusKm * Math.sqrt(rho0Term) / n;

	return {
		id: 'albers',
		project: function (longitudeRadians, latitudeRadians) {
			var theta;
			var rhoTerm;
			var rho;

			longitudeRadians = normalizeLongitudeRadiansForCentralMeridian(longitudeRadians, lambda0);
			theta = n * (longitudeRadians - lambda0);
			rhoTerm = cValue - (2 * n * Math.sin(latitudeRadians));

			if (rhoTerm < 0 || !Number.isFinite(rhoTerm)) {
				throw new Error('Invalid Albers projection input latitude.');
			}

			rho = radiusKm * Math.sqrt(rhoTerm) / n;

			return {
				xKm: rho * Math.sin(theta),
				yKm: rho0 - (rho * Math.cos(theta))
			};
		},
		inverseProject: function (xKm, yKm) {
			var rho;
			var theta;
			var phiTerm;
			var latitudeRadians;
			var longitudeRadians;

			rho = Math.sqrt((xKm * xKm) + ((rho0 - yKm) * (rho0 - yKm)));

			if (n < 0) {
				rho = -rho;
			}

			theta = Math.atan2(xKm, rho0 - yKm);
			phiTerm = (cValue - Math.pow((rho * n / radiusKm), 2)) / (2 * n);
			phiTerm = clampUnitValue(phiTerm, 'inverse Albers latitude term');
			latitudeRadians = Math.asin(phiTerm);
			longitudeRadians = lambda0 + (theta / n);

			return {
				longitudeRadians: longitudeRadians,
				latitudeRadians: latitudeRadians,
				longitudeDegrees: radiansToDegrees(longitudeRadians),
				latitudeDegrees: radiansToDegrees(latitudeRadians)
			};
		}
	};
}

/* Builds the spherical Azimuthal Equidistant pair while keeping X/Y in km. */
function createAzimuthalEquidistantProjection(projectionOptions) {
	var centralMeridianRadians;
	var latitudeOfOriginRadians;
	var radiusKm;
	var sinLatitudeOfOrigin;
	var cosLatitudeOfOrigin;

	centralMeridianRadians = degreesToRadians(projectionOptions.centralMeridian);
	latitudeOfOriginRadians = degreesToRadians(projectionOptions.latitudeOfOrigin);
	radiusKm = projectionOptions.radiusKm;
	sinLatitudeOfOrigin = Math.sin(latitudeOfOriginRadians);
	cosLatitudeOfOrigin = Math.cos(latitudeOfOriginRadians);

	return {
		id: 'azimuthalEquidistant',
		project: function (longitudeRadians, latitudeRadians) {
			var deltaLongitudeRadians;
			var sinLatitude;
			var cosLatitude;
			var cosAngularDistance;
			var angularDistance;
			var scaleFactor;

			deltaLongitudeRadians = normalizeLongitudeRadiansForCentralMeridian(longitudeRadians, centralMeridianRadians) - centralMeridianRadians;
			sinLatitude = Math.sin(latitudeRadians);
			cosLatitude = Math.cos(latitudeRadians);
			cosAngularDistance = clampUnitValue(
				sinLatitudeOfOrigin * sinLatitude +
				cosLatitudeOfOrigin * cosLatitude * Math.cos(deltaLongitudeRadians),
				'Azimuthal Equidistant angular distance cosine'
			);
			angularDistance = Math.acos(cosAngularDistance);

			if (Math.abs(angularDistance) < 1e-12) {
				return {
					xKm: 0,
					yKm: 0
				};
			}

			scaleFactor = angularDistance / Math.sin(angularDistance);

			return {
				xKm: radiusKm * scaleFactor * cosLatitude * Math.sin(deltaLongitudeRadians),
				yKm: radiusKm * scaleFactor * (
					cosLatitudeOfOrigin * sinLatitude -
					sinLatitudeOfOrigin * cosLatitude * Math.cos(deltaLongitudeRadians)
				)
			};
		},
		inverseProject: function (xKm, yKm) {
			var distanceKm;
			var angularDistance;
			var sinAngularDistance;
			var cosAngularDistance;
			var latitudeTerm;
			var latitudeRadians;
			var longitudeRadians;

			distanceKm = Math.sqrt((xKm * xKm) + (yKm * yKm));

			if (distanceKm < 1e-12) {
				return {
					longitudeRadians: centralMeridianRadians,
					latitudeRadians: latitudeOfOriginRadians,
					longitudeDegrees: radiansToDegrees(centralMeridianRadians),
					latitudeDegrees: radiansToDegrees(latitudeOfOriginRadians)
				};
			}

			angularDistance = distanceKm / radiusKm;

			if (angularDistance > Math.PI) {
				throw new Error('Azimuthal Equidistant inverse distance exceeds the spherical domain.');
			}

			sinAngularDistance = Math.sin(angularDistance);
			cosAngularDistance = Math.cos(angularDistance);
			latitudeTerm = cosAngularDistance * sinLatitudeOfOrigin +
				(yKm * sinAngularDistance * cosLatitudeOfOrigin / distanceKm);
			latitudeTerm = clampUnitValue(latitudeTerm, 'Azimuthal Equidistant inverse latitude');
			latitudeRadians = Math.asin(latitudeTerm);
			longitudeRadians = centralMeridianRadians + Math.atan2(
				xKm * sinAngularDistance,
				distanceKm * cosLatitudeOfOrigin * cosAngularDistance -
				yKm * sinLatitudeOfOrigin * sinAngularDistance
			);

			return {
				longitudeRadians: longitudeRadians,
				latitudeRadians: latitudeRadians,
				longitudeDegrees: radiansToDegrees(longitudeRadians),
				latitudeDegrees: radiansToDegrees(latitudeRadians)
			};
		}
	};
}

/* Builds the spherical Lambert Azimuthal Equal Area pair used by the CLI. */
function createLambertAzimuthalEqualAreaProjection(projectionOptions) {
	var centralMeridianRadians;
	var latitudeOfOriginRadians;
	var radiusKm;
	var sinLatitudeOfOrigin;
	var cosLatitudeOfOrigin;

	centralMeridianRadians = degreesToRadians(projectionOptions.centralMeridian);
	latitudeOfOriginRadians = degreesToRadians(projectionOptions.latitudeOfOrigin);
	radiusKm = projectionOptions.radiusKm;
	sinLatitudeOfOrigin = Math.sin(latitudeOfOriginRadians);
	cosLatitudeOfOrigin = Math.cos(latitudeOfOriginRadians);

	return {
		id: 'lambertAzimuthalEqualArea',
		project: function (longitudeRadians, latitudeRadians) {
			var deltaLongitudeRadians;
			var sinLatitude;
			var cosLatitude;
			var cosAngularDistance;
			var scaleFactor;
			var denominator;

			deltaLongitudeRadians = normalizeLongitudeRadiansForCentralMeridian(longitudeRadians, centralMeridianRadians) - centralMeridianRadians;
			sinLatitude = Math.sin(latitudeRadians);
			cosLatitude = Math.cos(latitudeRadians);
			cosAngularDistance = clampUnitValue(
				sinLatitudeOfOrigin * sinLatitude +
				cosLatitudeOfOrigin * cosLatitude * Math.cos(deltaLongitudeRadians),
				'Lambert Azimuthal Equal Area angular distance cosine'
			);
			denominator = 1 + cosAngularDistance;

			if (denominator <= 0) {
				throw new Error('Lambert Azimuthal Equal Area cannot project the antipode of its center.');
			}

			scaleFactor = Math.sqrt(2 / denominator);

			return {
				xKm: radiusKm * scaleFactor * cosLatitude * Math.sin(deltaLongitudeRadians),
				yKm: radiusKm * scaleFactor * (
					cosLatitudeOfOrigin * sinLatitude -
					sinLatitudeOfOrigin * cosLatitude * Math.cos(deltaLongitudeRadians)
				)
			};
		},
		inverseProject: function (xKm, yKm) {
			var distanceKm;
			var angularDistance;
			var distanceTerm;
			var sinAngularDistance;
			var cosAngularDistance;
			var latitudeTerm;
			var latitudeRadians;
			var longitudeRadians;

			distanceKm = Math.sqrt((xKm * xKm) + (yKm * yKm));
			distanceTerm = distanceKm / (2 * radiusKm);
			distanceTerm = clampUnitValue(distanceTerm, 'Lambert Azimuthal Equal Area inverse distance');
			angularDistance = 2 * Math.asin(distanceTerm);
			sinAngularDistance = Math.sin(angularDistance);
			cosAngularDistance = Math.cos(angularDistance);

			if (distanceKm < 1e-12) {
				return {
					longitudeRadians: centralMeridianRadians,
					latitudeRadians: latitudeOfOriginRadians,
					longitudeDegrees: radiansToDegrees(centralMeridianRadians),
					latitudeDegrees: radiansToDegrees(latitudeOfOriginRadians)
				};
			}

			latitudeTerm = cosAngularDistance * sinLatitudeOfOrigin +
				(yKm * sinAngularDistance * cosLatitudeOfOrigin / distanceKm);
			latitudeTerm = clampUnitValue(latitudeTerm, 'Lambert Azimuthal Equal Area inverse latitude');
			latitudeRadians = Math.asin(latitudeTerm);
			longitudeRadians = centralMeridianRadians + Math.atan2(
				xKm * sinAngularDistance,
				distanceKm * cosLatitudeOfOrigin * cosAngularDistance -
				yKm * sinLatitudeOfOrigin * sinAngularDistance
			);

			return {
				longitudeRadians: longitudeRadians,
				latitudeRadians: latitudeRadians,
				longitudeDegrees: radiansToDegrees(longitudeRadians),
				latitudeDegrees: radiansToDegrees(latitudeRadians)
			};
		}
	};
}

/* Builds the explicit spherical Lambert Conformal Conic pair used by the CLI. */
function createLambertConformalConicProjection(projectionOptions) {
	var centralMeridianRadians;
	var latitudeOfOriginRadians;
	var standardParallelOneRadians;
	var standardParallelTwoRadians;
	var radiusKm;
	var n;
	var f;
	var rho0;
	var parallelOneTangent;
	var parallelTwoTangent;
	var latitudeOfOriginTangent;

	centralMeridianRadians = degreesToRadians(projectionOptions.centralMeridian);
	latitudeOfOriginRadians = degreesToRadians(projectionOptions.latitudeOfOrigin);
	standardParallelOneRadians = degreesToRadians(projectionOptions.standardParallelOne);
	standardParallelTwoRadians = degreesToRadians(projectionOptions.standardParallelTwo);
	radiusKm = projectionOptions.radiusKm;
	parallelOneTangent = Math.tan((Math.PI / 2 + standardParallelOneRadians) / 2);
	parallelTwoTangent = Math.tan((Math.PI / 2 + standardParallelTwoRadians) / 2);
	latitudeOfOriginTangent = Math.tan((Math.PI / 2 + latitudeOfOriginRadians) / 2);

	if (standardParallelOneRadians === standardParallelTwoRadians) {
		n = Math.sin(standardParallelOneRadians);
	} else {
		n = Math.log(Math.cos(standardParallelOneRadians) / Math.cos(standardParallelTwoRadians)) /
			Math.log(parallelTwoTangent / parallelOneTangent);
	}

	if (!Number.isFinite(n) || n === 0) {
		throw new Error('Invalid Lambert Conformal Conic projection constant n.');
	}

	f = Math.cos(standardParallelOneRadians) * Math.pow(parallelOneTangent, n) / n;
	rho0 = radiusKm * f / Math.pow(latitudeOfOriginTangent, n);

	if (!Number.isFinite(f) || !Number.isFinite(rho0)) {
		throw new Error('Invalid Lambert Conformal Conic projection constants.');
	}

	return {
		id: 'lambertConformalConic',
		project: function (longitudeRadians, latitudeRadians) {
			var deltaLongitudeRadians;
			var latitudeTangent;
			var rho;
			var theta;

			deltaLongitudeRadians = normalizeLongitudeRadiansForCentralMeridian(longitudeRadians, centralMeridianRadians) - centralMeridianRadians;
			latitudeTangent = Math.tan((Math.PI / 2 + latitudeRadians) / 2);
			rho = radiusKm * f / Math.pow(latitudeTangent, n);
			theta = n * deltaLongitudeRadians;

			if (!Number.isFinite(rho)) {
				throw new Error('Invalid Lambert Conformal Conic projection input latitude.');
			}

			return {
				xKm: rho * Math.sin(theta),
				yKm: rho0 - (rho * Math.cos(theta))
			};
		},
		inverseProject: function (xKm, yKm) {
			var rho;
			var theta;
			var longitudeRadians;
			var latitudeRadians;

			rho = Math.sqrt((xKm * xKm) + ((rho0 - yKm) * (rho0 - yKm)));

			if (n < 0) {
				rho = -rho;
			}

			theta = Math.atan2(xKm, rho0 - yKm);
			latitudeRadians = 2 * Math.atan(Math.pow(radiusKm * f / rho, 1 / n)) - (Math.PI / 2);
			longitudeRadians = centralMeridianRadians + (theta / n);

			if (!Number.isFinite(latitudeRadians) || !Number.isFinite(longitudeRadians)) {
				throw new Error('Invalid Lambert Conformal Conic inverse result.');
			}

			return {
				longitudeRadians: longitudeRadians,
				latitudeRadians: latitudeRadians,
				longitudeDegrees: radiansToDegrees(longitudeRadians),
				latitudeDegrees: radiansToDegrees(latitudeRadians)
			};
		}
	};
}

/*
Reads a supported projection name and complete numeric projection options.
Changes nothing outside the returned projection object and writes nothing.
Returns one explicit spherical forward/inverse projection implementation.
*/
function createProjection(projectionName, projectionOptions) {
	if (projectionName === 'albers') {
		return createAlbersProjection(projectionOptions);
	}

	if (projectionName === 'azimuthalEquidistant') {
		return createAzimuthalEquidistantProjection(projectionOptions);
	}

	if (projectionName === 'lambertAzimuthalEqualArea') {
		return createLambertAzimuthalEqualAreaProjection(projectionOptions);
	}

	if (projectionName === 'lambertConformalConic') {
		return createLambertConformalConicProjection(projectionOptions);
	}

	throw new Error('Unsupported projection name: ' + projectionName + '.');
}

/* Uses a literal tuple mean, including repeated closures; it is not area-weighted or geometry-aware. */
function computeCoordinateMean(coordinateTuples) {
	var longitudeSum;
	var latitudeSum;
	var tupleIndex;
	var coordinateTuple;

	if (!coordinateTuples || coordinateTuples.length === 0) {
		throw new Error('Cannot compute coordinateMean without coordinate tuples.');
	}

	longitudeSum = 0;
	latitudeSum = 0;

	for (tupleIndex = 0; tupleIndex < coordinateTuples.length; tupleIndex += 1) {
		coordinateTuple = coordinateTuples[tupleIndex];

		if (!coordinateTuple || !Number.isFinite(coordinateTuple.longitudeDegrees) || !Number.isFinite(coordinateTuple.latitudeDegrees)) {
			throw new Error('Cannot compute coordinateMean from a nonnumeric coordinate tuple.');
		}

		longitudeSum += coordinateTuple.longitudeDegrees;
		latitudeSum += coordinateTuple.latitudeDegrees;
	}

	return {
		longitudeDegrees: longitudeSum / coordinateTuples.length,
		latitudeDegrees: latitudeSum / coordinateTuples.length
	};
}

/* Rejects invalid demonstration conic constants before conic conversion. */
function validateConicProjectionDefaults(projectionDefaults, radiusKm) {
	var projectionOptions;

	if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
		throw new Error('Cannot validate projection defaults without a positive radiusKm.');
	}

	projectionOptions = {
		radiusKm: radiusKm,
		centralMeridian: projectionDefaults.centralMeridian,
		latitudeOfOrigin: projectionDefaults.latitudeOfOrigin,
		standardParallelOne: projectionDefaults.standardParallelOne,
		standardParallelTwo: projectionDefaults.standardParallelTwo
	};

	try {
		createProjection('albers', projectionOptions);
		createProjection('lambertConformalConic', projectionOptions);
	} catch (errorObject) {
		throw new Error('Invalid conic projection defaults: ' + errorObject.message);
	}
}

/* Builds shared anchors and visible ±10° conic demonstration defaults; selected conics are validated. */
function createProjectionDefaults(coordinateMean, radiusKm, projectionName) {
	var projectionDefaults;

	if (!coordinateMean || !Number.isFinite(coordinateMean.longitudeDegrees) || !Number.isFinite(coordinateMean.latitudeDegrees)) {
		throw new Error('Cannot create projection defaults without a valid coordinateMean.');
	}

	projectionDefaults = {
		coordinateMean: {
			longitudeDegrees: coordinateMean.longitudeDegrees,
			latitudeDegrees: coordinateMean.latitudeDegrees
		},
		sourceAnchor: {
			longitudeDegrees: coordinateMean.longitudeDegrees,
			latitudeDegrees: coordinateMean.latitudeDegrees
		},
		targetAnchor: {
			longitudeDegrees: coordinateMean.longitudeDegrees,
			latitudeDegrees: coordinateMean.latitudeDegrees
		},
		centralMeridian: coordinateMean.longitudeDegrees,
		latitudeOfOrigin: coordinateMean.latitudeDegrees,
		standardParallelOne: coordinateMean.latitudeDegrees - 10,
		standardParallelTwo: coordinateMean.latitudeDegrees + 10
	};

	if (projectionName === 'albers' || projectionName === 'lambertConformalConic' || projectionName === undefined) {
		validateConicProjectionDefaults(projectionDefaults, radiusKm);
	}

	return projectionDefaults;
}

/* Reads one nonempty UTF-8 KML input and leaves the source file unchanged. */
function readKmlFile(inputKmlPath) {
	var xmlText;

	if (!inputKmlPath || !fs.existsSync(inputKmlPath)) {
		throw new Error('Input KML file does not exist: ' + inputKmlPath + '.');
	}

	xmlText = fs.readFileSync(inputKmlPath, 'utf8').replace(/^\uFEFF/, '');

	if (!xmlText.trim()) {
		throw new Error('Input KML file is empty: ' + inputKmlPath + '.');
	}

	return xmlText;
}

/* Parses the source text into an editable DOM and surfaces XML parse errors. */
function parseKmlXml(xmlText, inputKmlPath) {
	var parseErrors;
	var parser;
	var kmlDocument;

	parseErrors = [];
	parser = new DOMParser({
		onError: function (levelName, messageText) {
			if (levelName === 'error' || levelName === 'fatalError') {
				parseErrors.push(messageText);
			}
		}
	});

	try {
		kmlDocument = parser.parseFromString(xmlText, 'text/xml');
	} catch (errorObject) {
		if (parseErrors.length === 0) {
			parseErrors.push(errorObject.message || String(errorObject));
		}
	}

	if (!kmlDocument || !kmlDocument.documentElement || parseErrors.length > 0) {
		throw new Error('KML XML parse failed for ' + inputKmlPath + ': ' + (parseErrors[0] || 'missing document element') + '.');
	}

	return kmlDocument;
}

/* Resolves namespaced element names so every coordinates element is found. */
function getNodeLocalName(nodeObject) {
	var nodeName;
	var colonIndex;

	if (!nodeObject) {
		return '';
	}

	nodeName = nodeObject.localName || nodeObject.nodeName || '';
	colonIndex = nodeName.indexOf(':');

	if (colonIndex >= 0) {
		return nodeName.slice(colonIndex + 1);
	}

	return nodeName;
}

/* Collects coordinate elements in document order without geometry filtering. */
function collectCoordinateElements(kmlDocument) {
	var allElements;
	var coordinateElements;
	var elementIndex;

	allElements = kmlDocument.getElementsByTagName('*');
	coordinateElements = [];

	for (elementIndex = 0; elementIndex < allElements.length; elementIndex += 1) {
		if (getNodeLocalName(allElements[elementIndex]) === 'coordinates') {
			coordinateElements.push(allElements[elementIndex]);
		}
	}

	return coordinateElements;
}

/* Parses one longitude,latitude[,altitude] token for projection. */
function parseCoordinateTuple(rawCoordinateTuple, contextLabel) {
	var tupleParts;
	var longitudeText;
	var latitudeText;
	var longitudeDegrees;
	var latitudeDegrees;

	tupleParts = rawCoordinateTuple.split(',');

	if (tupleParts.length < 2 || tupleParts.length > 3) {
		throw new Error('Malformed coordinate tuple in ' + contextLabel + ': expected longitude,latitude[,altitude] but got "' + rawCoordinateTuple + '".');
	}

	longitudeText = tupleParts[0].trim();
	latitudeText = tupleParts[1].trim();

	if (!longitudeText || !latitudeText) {
		throw new Error('Malformed coordinate tuple in ' + contextLabel + ': missing longitude or latitude in "' + rawCoordinateTuple + '".');
	}

	longitudeDegrees = Number(longitudeText);
	latitudeDegrees = Number(latitudeText);

	if (!Number.isFinite(longitudeDegrees) || !Number.isFinite(latitudeDegrees)) {
		throw new Error('Malformed coordinate tuple in ' + contextLabel + ': longitude and latitude must be numeric in "' + rawCoordinateTuple + '".');
	}

	return {
		rawTuple: rawCoordinateTuple,
		longitudeDegrees: longitudeDegrees,
		latitudeDegrees: latitudeDegrees,
		longitudeRadians: degreesToRadians(longitudeDegrees),
		latitudeRadians: degreesToRadians(latitudeDegrees)
	};
}

/* Splits one coordinate block while preserving its tuple grouping. */
function parseCoordinateBlock(rawCoordinateText, blockLabel) {
	var trimmedCoordinateText;
	var rawTuples;
	var coordinateTuples;
	var tupleIndex;

	trimmedCoordinateText = (rawCoordinateText || '').trim();

	if (!trimmedCoordinateText) {
		return [];
	}

	rawTuples = trimmedCoordinateText.split(/\s+/);
	coordinateTuples = [];

	for (tupleIndex = 0; tupleIndex < rawTuples.length; tupleIndex += 1) {
		coordinateTuples.push(parseCoordinateTuple(rawTuples[tupleIndex], blockLabel + ', tuple ' + (tupleIndex + 1)));
	}

	return coordinateTuples;
}

/* Loads the DOM and grouped tuples needed for one conversion. */
function loadConversionInput(inputKmlPath) {
	var kmlDocument;
	var coordinateElements;
	var coordinateBlocks;
	var allCoordinateTuples;
	var elementIndex;
	var coordinateTuples;

	kmlDocument = parseKmlXml(readKmlFile(inputKmlPath), inputKmlPath);
	coordinateElements = collectCoordinateElements(kmlDocument);
	coordinateBlocks = [];
	allCoordinateTuples = [];

	for (elementIndex = 0; elementIndex < coordinateElements.length; elementIndex += 1) {
		coordinateTuples = parseCoordinateBlock(
			coordinateElements[elementIndex].textContent,
			'coordinates element ' + (elementIndex + 1)
		);
		coordinateBlocks.push(coordinateTuples);
		allCoordinateTuples = allCoordinateTuples.concat(coordinateTuples);
	}

	return {
		kmlDocument: kmlDocument,
		coordinateElements: coordinateElements,
		coordinateBlocks: coordinateBlocks,
		allCoordinateTuples: allCoordinateTuples
	};
}

/* Keeps serialized longitudes in the inclusive -180 through 180 range. */
function normalizeLongitudeDegrees(longitudeDegrees) {
	while (longitudeDegrees > 180) {
		longitudeDegrees -= 360;
	}

	while (longitudeDegrees < -180) {
		longitudeDegrees += 360;
	}

	return longitudeDegrees;
}

/* Emits the intentionally simple eight-decimal lon,lat,0 representation. */
function formatCoordinateTuple(longitudeDegrees, latitudeDegrees) {
	if (longitudeDegrees === 0) {
		longitudeDegrees = 0;
	}

	if (latitudeDegrees === 0) {
		latitudeDegrees = 0;
	}

	return normalizeLongitudeDegrees(longitudeDegrees).toFixed(8) + ',' + latitudeDegrees.toFixed(8) + ',0';
}

/*
Per-coordinate path:
Earth lon/lat
→ Earth projected X/Y in km
→ X/Y offset from Earth anchor
→ same X/Y offset around target anchor
→ target projected X/Y
→ target lon/lat
*/
function convertCoordinateTuple(coordinateTuple, earthProjection, targetProjection, earthAnchorProjected, targetAnchorProjected) {
	var sourceProjected;
	var targetProjected;
	var targetCoordinate;

	sourceProjected = earthProjection.project(coordinateTuple.longitudeRadians, coordinateTuple.latitudeRadians);
	targetProjected = {
		xKm: targetAnchorProjected.xKm + (sourceProjected.xKm - earthAnchorProjected.xKm),
		yKm: targetAnchorProjected.yKm + (sourceProjected.yKm - earthAnchorProjected.yKm)
	};
	targetCoordinate = targetProjection.inverseProject(targetProjected.xKm, targetProjected.yKm);

	if (!Number.isFinite(targetCoordinate.longitudeDegrees) || !Number.isFinite(targetCoordinate.latitudeDegrees)) {
		throw new Error('Inverse projection returned a non-finite coordinate.');
	}

	return formatCoordinateTuple(targetCoordinate.longitudeDegrees, targetCoordinate.latitudeDegrees);
}

/* Replaces each original block in document order without changing its parent. */
function rewriteCoordinateBlocks(conversionInput, convertedBlocks) {
	var blockIndex;

	for (blockIndex = 0; blockIndex < conversionInput.coordinateElements.length; blockIndex += 1) {
		conversionInput.coordinateElements[blockIndex].textContent = convertedBlocks[blockIndex].join(' ');
	}
}

/* Runs one complete conversion using shared anchors and unchanged km offsets. */
function convertKmlFile(conversionSettings) {
	var conversionInput;
	var coordinateMean;
	var projectionDefaults;
	var sharedProjectionOptions;
	var earthProjection;
	var targetProjection;
	var earthAnchorProjected;
	var targetAnchorProjected;
	var convertedBlocks;
	var blockIndex;
	var tupleIndex;
	var coordinateBlock;
	var convertedBlock;
	var sourceAnchorLongitudeRadians;
	var sourceAnchorLatitudeRadians;
	var targetAnchorLongitudeRadians;
	var targetAnchorLatitudeRadians;

	conversionInput = loadConversionInput(conversionSettings.inputKmlPath);
	coordinateMean = computeCoordinateMean(conversionInput.allCoordinateTuples);
	projectionDefaults = createProjectionDefaults(
		coordinateMean,
		conversionSettings.targetRadiusKm,
		conversionSettings.projectionName
	);
	sharedProjectionOptions = {
		centralMeridian: projectionDefaults.centralMeridian,
		latitudeOfOrigin: projectionDefaults.latitudeOfOrigin,
		standardParallelOne: projectionDefaults.standardParallelOne,
		standardParallelTwo: projectionDefaults.standardParallelTwo
	};
	/* Earth projection uses earthRadiusKm, so its projected units are Earth km. */
	earthProjection = createProjection(conversionSettings.projectionName, {
		radiusKm: earthRadiusKm,
		centralMeridian: sharedProjectionOptions.centralMeridian,
		latitudeOfOrigin: sharedProjectionOptions.latitudeOfOrigin,
		standardParallelOne: sharedProjectionOptions.standardParallelOne,
		standardParallelTwo: sharedProjectionOptions.standardParallelTwo
	});
	/* Target projection uses targetRadiusKm but receives those same km offsets unchanged. */
	targetProjection = createProjection(conversionSettings.projectionName, {
		radiusKm: conversionSettings.targetRadiusKm,
		centralMeridian: sharedProjectionOptions.centralMeridian,
		latitudeOfOrigin: sharedProjectionOptions.latitudeOfOrigin,
		standardParallelOne: sharedProjectionOptions.standardParallelOne,
		standardParallelTwo: sharedProjectionOptions.standardParallelTwo
	});

	sourceAnchorLongitudeRadians = degreesToRadians(projectionDefaults.sourceAnchor.longitudeDegrees);
	sourceAnchorLatitudeRadians = degreesToRadians(projectionDefaults.sourceAnchor.latitudeDegrees);
	targetAnchorLongitudeRadians = degreesToRadians(projectionDefaults.targetAnchor.longitudeDegrees);
	targetAnchorLatitudeRadians = degreesToRadians(projectionDefaults.targetAnchor.latitudeDegrees);
	earthAnchorProjected = earthProjection.project(sourceAnchorLongitudeRadians, sourceAnchorLatitudeRadians);
	targetAnchorProjected = targetProjection.project(targetAnchorLongitudeRadians, targetAnchorLatitudeRadians);
	convertedBlocks = [];

	for (blockIndex = 0; blockIndex < conversionInput.coordinateBlocks.length; blockIndex += 1) {
		coordinateBlock = conversionInput.coordinateBlocks[blockIndex];
		convertedBlock = [];

		for (tupleIndex = 0; tupleIndex < coordinateBlock.length; tupleIndex += 1) {
			convertedBlock.push(convertCoordinateTuple(
				coordinateBlock[tupleIndex],
				earthProjection,
				targetProjection,
				earthAnchorProjected,
				targetAnchorProjected
			));
		}

		convertedBlocks.push(convertedBlock);
	}

	rewriteCoordinateBlocks(conversionInput, convertedBlocks);
	fs.writeFileSync(conversionSettings.outputKmlPath, new XMLSerializer().serializeToString(conversionInput.kmlDocument), 'utf8');

	return {
		coordinateCount: conversionInput.allCoordinateTuples.length
	};
}

/* Resolves one named target or validates one positive custom radius. */
function resolveTargetArgument(targetArgument) {
	var normalizedTargetArgument;
	var numericTargetRadius;
	var targetIndex;
	var targetObject;

	if (targetArgument === undefined || targetArgument === null) {
		throw new Error('Target name or radius is required.');
	}

	normalizedTargetArgument = String(targetArgument).trim();

	if (!normalizedTargetArgument) {
		throw new Error('Target name or radius is required.');
	}

	numericTargetRadius = Number(normalizedTargetArgument);

	if (Number.isFinite(numericTargetRadius) && numericTargetRadius > 0) {
		return {
			key: 'custom',
			name: 'Custom radius',
			radiusKm: numericTargetRadius
		};
	}

	normalizedTargetArgument = normalizedTargetArgument.toLowerCase();

	for (targetIndex = 0; targetIndex < targetObjects.length; targetIndex += 1) {
		targetObject = targetObjects[targetIndex];

		if (targetObject.key === normalizedTargetArgument) {
			return {
				key: targetObject.key,
				name: targetObject.name,
				radiusKm: targetObject.radiusKm
			};
		}
	}

	throw new Error('Unsupported target name or radius: ' + targetArgument + '.');
}

/* Parses named CLI flags before any file is written. */
function parseCommandLineArguments(rawArguments) {
	var optionValues;
	var argumentIndex;
	var argumentName;
	var argumentValue;
	var targetArgument;
	var targetSettings;

	if (!rawArguments || rawArguments.length === 0) {
		throw new Error('Named CLI flags are required.');
	}

	optionValues = {};

	for (argumentIndex = 0; argumentIndex < rawArguments.length; argumentIndex += 1) {
		argumentName = String(rawArguments[argumentIndex]).trim();

		if (argumentName.indexOf('--') !== 0) {
			throw new Error('Expected named flags, but received: ' + argumentName + '.');
		}

		if (argumentName !== '--input-kml' && argumentName !== '--target-object' && argumentName !== '--target-radius' && argumentName !== '--projection' && argumentName !== '--output-kml') {
			throw new Error('Unknown option: ' + argumentName + '.');
		}

		if (optionValues[argumentName] !== undefined) {
			throw new Error('Duplicate option: ' + argumentName + '.');
		}

		argumentIndex += 1;

		if (argumentIndex >= rawArguments.length) {
			throw new Error('Missing value for ' + argumentName + '.');
		}

		argumentValue = String(rawArguments[argumentIndex]).trim();

		if (!argumentValue || argumentValue.indexOf('--') === 0) {
			throw new Error('Missing value for ' + argumentName + '.');
		}

		optionValues[argumentName] = argumentValue;
	}

	if (!optionValues['--input-kml'] || !optionValues['--projection'] || !optionValues['--output-kml']) {
		throw new Error('The --input-kml, --projection, and --output-kml options are required.');
	}

	if (!optionValues['--target-object'] && !optionValues['--target-radius']) {
		throw new Error('Supply --target-object or --target-radius.');
	}

	if (pathsReferToSameFile(optionValues['--input-kml'], optionValues['--output-kml'])) {
		throw new Error('Input and output KML paths must differ.');
	}

	if (supportedProjectionNames.indexOf(optionValues['--projection']) < 0) {
		throw new Error('Unsupported projection name: ' + optionValues['--projection'] + '.');
	}

	if (optionValues['--target-radius']) {
		targetArgument = optionValues['--target-radius'];
		targetSettings = resolveTargetArgument(targetArgument);
	} else {
		targetArgument = optionValues['--target-object'];
		targetSettings = resolveTargetArgument(targetArgument);
	}

	if (!Number.isFinite(targetSettings.radiusKm) || targetSettings.radiusKm <= 0) {
		throw new Error('Target radius must be positive.');
	}

	return {
		inputKmlPath: optionValues['--input-kml'],
		targetArgument: targetArgument,
		targetKey: targetSettings.key,
		targetName: targetSettings.name,
		targetRadiusKm: targetSettings.radiusKm,
		projectionName: optionValues['--projection'],
		outputKmlPath: optionValues['--output-kml']
	};
}

/* Compares normalized paths without treating case differently on Windows. */
function pathsReferToSameFile(inputKmlPath, outputKmlPath) {
	var resolvedInputPath;
	var resolvedOutputPath;

	resolvedInputPath = path.resolve(inputKmlPath);
	resolvedOutputPath = path.resolve(outputKmlPath);

	if (process.platform === 'win32') {
		return resolvedInputPath.toLowerCase() === resolvedOutputPath.toLowerCase();
	}

	return resolvedInputPath === resolvedOutputPath;
}

/* Prints the one supported command form after argument validation fails. */
function printUsage() {
	console.error('Usage: node convertEarthKmlToObjectBasic_001.js --input-kml <path> --target-object <name> [--target-radius <km>] --projection <name> --output-kml <path>');
}

/*
Reads raw process arguments, runs the basic conversion, and writes the
requested output KML. Returns process exit code 0 for success or 1 for a
concise failure.
*/
/* Converts one requested file and reports exactly one PASS or FAIL result. */
function runCli(rawArguments) {
	var conversionSettings;
	var conversionResult;
	var targetSummary;

	try {
		conversionSettings = parseCommandLineArguments(rawArguments);
	} catch (errorObject) {
		console.error('FAIL: ' + errorObject.message);
		printUsage();
		return 1;
	}

	try {
		conversionResult = convertKmlFile(conversionSettings);
	} catch (errorObject) {
		console.error('FAIL: ' + errorObject.message);
		return 1;
	}

	if (conversionSettings.targetKey === 'custom') {
		targetSummary = conversionSettings.targetArgument + ' km';
	} else {
		targetSummary = conversionSettings.targetName + ' (' + conversionSettings.targetRadiusKm + ' km)';
	}

	console.log('PASS: converted ' + conversionResult.coordinateCount + ' coordinate tuples to ' + targetSummary + ' using ' + conversionSettings.projectionName + '; output ' + conversionSettings.outputKmlPath);

	return 0;
}

/* Runtime dependencies are limited to fs, path, and @xmldom/xmldom. */

if (require.main === module) {
	process.exitCode = runCli(process.argv.slice(2));
}
