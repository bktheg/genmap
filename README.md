# dortmund1826 genmap-Tool

## English Version
(Deutsche Version: siehe unten)

The genmap-tool is a data processing tool created for dortmund1826 (https.//dortmund1826.de). It is designed to process data from the historical documents of the Rheinisch-Westfälisches Urkataster (rhinelandian and westphalian land register) from the 1820s. It processes transcribed documents and digitalized vector maps and creates one map containing all relevant information from the old land register and several additional files.

The tool is based on NodeJS and tested on NodeJS 16. It also requires input data from a SpatiaLite-Database and a number of excel files. The resulting geodata is written to a postgis database.

This tool is heavily tied to the specific documents and the exact structure of the Rheinisch-Westfälisches Urkataster. As all documents of this land register are in German (and can only be found in local archives and departments), all specific terms used in the land register are in German and the main audience probably speaks German the rest of the documentation is in German as well.

## Deutsche Version

Das genmap-tool dient dazu die Daten des Rheinisch-Westfälischen Urkatasters aus den 1820ern für dortmund1826.de aufzubereiten (https://dortmund1826.de). Die Software nimmt die abgeschriebenen Dokumente und abgezeichneten Urkarten und erzeugt hieraus Kartendaten mit allen relevanten Informationen des Urkatasters sowie eine Anzahl weiterer Dateien.

Das Tool basiert auf NodeJS. Getestet wurde es mit NodeJS 16. Die Eingangsdaten müssen als SpatiaLite-Datei (Kartendaten) sowie Exceldateien (abgeschriebene Dokumente) bereitgestellt werden. Die von der Software erzeugten Daten werden in eine PostGIS-Datenbank geschrieben.

### Katasterverzeichnis
Im Katasterverzeichnis werden alle abgeschriebenen Unterlagen als Exceldateien abgelegt. Beim genmap-Tool liegt dieses *nicht* bei. Ein Beispielsatz an Dateien ist hier zu finden: https://github.com/bktheg/dortmund1826-data

Das Katasterverzeichnis hat folgende Verzeichnisstruktur:
* additional_infos - enthält alle Excel-Dateien mit Zusatzinformationen wie Zitaten aus Büchern, Links auf Wikipediaartikel. Verwendet in der Parzellenansicht auf dortmund1826.de
* admin - enthält die Excel-Dateien zur Verwaltungsstruktur, also zu Gemeinden, Fluren, Bürgermeistereien und Kreisen. Hier wird festgelegt, was überhaupt existiert und was auf der Karte angezeigt werden soll
* auto - internes Verzeichnis des Tools. Ignorieren.
* changesets - Ablage von Fortschreibungsinformationen als JSON-Dateien.
* flurbücher - enthält alle abgeschriebenen Flurbücher als Exceldateien
* häuserbücher - enthält alle abgeschriebenen Häuserbücher als Exceldateien. Das Feature ist aktuell noch experimentell.
* mutterrollen_namen - enthält alle abgeschriebenen Namenslisten aus Mutterrollen/Güterverzeichnissen als Exceldateien.
* net - enthält alle abgeschriebenen Vermessungsunterlagen als Exceldateien
* urkataster - enthält alle Vermessungsangaben zu einzelnen Parzellen als JSON-Dateien. Wenn zu einer Parzelle eine JSON-Datei existiert hat diese Vorrang vor der abgezeichneten Parzelle.
* out_mutterrollen - Ausgabeverzeichnis des Tools für die Eigentümerlisten einer Gemeinde
* out_metadata - Ausgabeverzeichnis für alle Dateien mit Metadaten für dortmund1826.de
* out_validation - Ausgabeverzeichnis mit allen Validierungsinformationen

### Installation

Benötigte Software:
* NodeJS 16
* PostGIS
* Ein GIS zum Digitalisieren der Urkarten, z.B. QGIS

Installationsschritte:
* `npm -i -g typescript`
* `npm ci`
* Datei ".env.example" nach ".env" kopieren und den Inhalt anpassen

### Ausführen
Das Tool kann im Installationsverzeichnis entweder über `npm run genmap --` oder `node ./dist/cli.js` ausgeführt werden.

Hier die üblichen Kommandos als Beispiel:

    node ./dist/cli.js --help

Übersicht über alle Befehle des Tools

    node ./dist/cli.js map

Erzeugt die Kartendaten und Metadaten für alle Gemeinden mit als erledigt markierten Fluren aus den Eingabedateien. Alle zuvor existierenden Kartendaten werden verworfen.

    node ./dist/cli.js map dortmund

Ergeugt die Kartendaten für die Gemeinde "dortmund" (neu). Es werden nur als erledigt markierte Fluren verarbeitet. Alle bereits existierenden Kartendaten zu dieser Gemeinde werden vorher gelöscht. Alle anderen Gemeinden bleiben so, wie sie sind. 

    node ./dist/cli.js generate-net

Ließt die abgeschriebenen Vermessungsinformationen und erzeugt das Vermessungsnetz für alle Gemeinden neu

    node ./dist/cli.js validate

Validiert alle Gemeinden mit geplanten oder erledigten Fluren und schreibt die Validierungsergebnisse in den Ordner out_validation im Kataster-Verzeichnis

    node ./dist/cli.js metadata

Erzeugt alle Metadaten für alle Gemeinden neu