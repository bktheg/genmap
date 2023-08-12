# dortmund1826 genmap-Tool

## English Version
(Deutsche Version: siehe unten)

The genmap-tool is a data processing tool created for dortmund1826 (https://dortmund1826.de). It is designed to process data from the historical documents of the Rheinisch-Westfälisches Urkataster (rhinelandian and westphalian land register) from the 1820s. It processes transcribed documents and digitalized vector maps and creates one map containing all relevant information from the old land register and several additional files.

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
** Die SpatiaLite-Datenbank wird automatisch unter dem konfigurierten Pfad angelegt wenn das Tool das erste Mal auf diese zugreift
** Die Tabellen in der Postgis-Datenbank werden automatisch angelegt. Es genügt eine leeres, existierendes Schema zu konfigurieren. Das Tool benötigt dementsprechend auch die Rechte Tabellen anzulegen/zu ändern/zu löschen
* `node ./dist/cli.js map`
* Die Layer der SpatiaLite-Datenbank und der Postgis-Datenbank im GIS einrichten

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

### Daten
Ein Beispieldatensatz ist unter https://github.com/bktheg/dortmund1826-data zu finden. Dieser enthält auch aktuelle Vorlagen für Vermessungsdateien (_vorlage_net.xlsx), Flurbücher (_vorlage_flurbuch.xlsx) und Namenslisten (_vorlage_mutterrollen_namen.xlsx).

### Vermessungsdateien
Neue Vermessungsdateien müssen im Ordner "net" abgelegt werden. Unterverzeichnisse werden dabei ebenfalls durchsucht. Im Beispieldatensatz sind die Dateien nach Quelle (Archiv/Katasteramt) gegliedert. Im Unterordner "sta" finden sich Beispielsweise die Abschriften aus den Beständen des Stadtarchivs Dortmund, im Unterordnet "lav" die aus den Beständen des Landesarchivs NRW Abteilung Westfalen. Die Vermessungsdateien müssen dabei die ID der Gemeinde im Namen haben, Prefixe getrennt durch "-" sind aber möglich. Im Beispieldatensatz sind die Prefixe die Nummern im Bestand des jeweiligen Archivs. "25-dellwig.xlsx" meint folglich das Vermessungsnetz der Gemeinde Dellwig, Nummer 25 im Bestand des Stadtarchivs Dortmund (konkret im Best. 162/002). Die IDs der Gemeinden sind in den Dateien im Verzeichnis "admin" zu finden.

Der Aufbau der Vorlagendatei entspricht dem üblichen Aufbau der Vermessungsunterlagen damals, genauer dem Abschnitt "Berechnung goniometrischer Koordinaten". Bei sehr frühen Vermessungen kann der Aufbau in den Quellen auch abweichen. Relevant für dortmund1826.de sind nur die Spalten "Namen der Stationen", "gemessene Winkel", "Anliegende Seite", "Zusammengestellte Coordinaten" und "Coorigierte Coordinaten". Die Software bevorzugt dabei die Kombination "Namen der Stationen" und "Coorigierte Coordinaten". Falls letztere nicht vorhanden sind werden die "Zusammengestellten Coordinaten" genommen und nur wenn diese ebenfalls fehlen die "gemessenen Winkel" und "Anliegenden Seiten". Es ist also nicht notwendig alle Spalten abzuschreiben.

#### Stationen

Der "Name der Station" ist typischerweise eine Nummer, die für eine Flur eindeutig ist. Punkte des übergeordneten Netzes werden mit einem "#" beginnend geschrieben. Punkte aus einer anderen Flur wiederum sind mit der Flurnummer als Suffix zu erfassen (römische Ziffern!). Bei Punkten aus anderen Gemeinden muss zusätzlich die ID angegeben werden. Beispiele für ein angenommenes Flur 5:
* "3" - Punkt 3 des Flurs 5
* "3 XIII" - Punkt 3 des Flurs 13
* "3 XI dortmund" - Punkt 3 des Flurs 11 der Gemeinde Dortmund
* "#3" - Punkt 3 im Vermessungsnetz 4. Ordnung
* "#dortmund" - Punkt "Dortmund" im Vermessungsnetz 1.-3. Ordnung

Für einzelne Gemeinden lässt sich außerdem ein Modus aktivieren (in der jeweiligen admin-Datei), in dem die Punkte pro Gemeinde und nicht pro Flur erfasst werden. Ein Punkt "13" wäre dann der Punkt 13 in der Gemeinde, egal ob in Flur I oder in Flur X verwendet wird.

Die genaue Schreibweise der Punkte (Stationen) ist wichtig, da die Software gleiche Punktangaben aus verschiedenen Quellen mittelt. Hier empfielt es sich auch im Zweifelsfall von der Benennung in den Quellen abzuweichen um eine bessere Mittelung zu erreichen (sofern von einem identischen Vermessungspunkt ausgegangen werden kann). Dies vermeidet später Lücken bei der Georeferenzierung der Urkarten. Bei zu großen Abweichungen der Punkte zueinander wird eine Warnung im Log ausgegeben.