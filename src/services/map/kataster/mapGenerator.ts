import * as mapReader from '#services/map/kataster/mapReader';
import * as mapWriter from '#services/map/kataster/mapWriter';
import * as metadataJsonWriter from '#services/map/kataster/metadataJsonWriter';
import * as pointCalculator from '#services/map/kataster/pointCalculator'
import {AbsolutePointDescriptor, PointDescriptor, MultiWayPointDescriptor, PointType} from '#services/map/kataster/pointDescriptors'
import * as parzellenReader from '#services/map/kataster/parzellenReader'
import * as netReader from '#services/map/kataster/netReader'
import * as gemeindeType from '#services/map/kataster/gemeindeType'
import * as mutterrolle from '#services/map/kataster/mutterrolle'
import { generateUrkatasterInfo } from '#services/map/kataster/urkatasterInfoGenerator';
import { consola } from 'consola';
import { createRawDataReader } from './rawDataReader.js';

function calculateAreas(registry:parzellenReader.ParzellenRegistry, points:Map<String,PointDescriptor>):mapWriter.CalculatedArea[] {
    const calculatedAreas:mapWriter.CalculatedArea[] = [];
    for( const p of registry.all() ) {
        for( const a of p.area ) {
            const c = new mapWriter.CalculatedArea(p.gemeinde, p.flur, p.nr);
            c.validFrom = p.validFrom;
            c.validTill = p.validTill;
            c.typ = a.type == parzellenReader.AreaTyp.Default ? p.typ : a.type;
            c.fortschreibung = p.changeset

            for( const ring of a.rings ) {
                const ringPoints = [];
                for( const point of ring.points ) {
                    const absolutePoint = points.get(point.id);
                    if( !absolutePoint || !absolutePoint.isAbsolute() ) {
                        consola.warn("Fehlender Punkt in Parzellenberechnung", p.id());
                        continue;
                    }
                    ringPoints.push(absolutePoint);
                }
                c.rings.push(ringPoints);
            }

            if( (a.type == parzellenReader.AreaTyp.Default) && c.typ != a.type ) {
                const c2 = new mapWriter.CalculatedArea(p.gemeinde, p.flur, p.nr);
                c2.validFrom = p.validFrom;
                c2.validTill = p.validTill;
                c2.typ = parzellenReader.AreaTyp.Default;
                c2.rings = c.rings;
                c2.fortschreibung = p.changeset
                calculatedAreas.push(c2);
            }

            calculatedAreas.push(c);
        }
    }
    return calculatedAreas;
}

function calculateFluren(net:netReader.NetPoints, points:Map<String,PointDescriptor>):mapWriter.CalculatedFlur[] {
    // TODO
    const whitelisted = new Set(["0-Dortmund-22", "0-Dortmund-15", "0-Dortmund-13"]);

    const calculatedAreas:mapWriter.CalculatedFlur[] = [];
    for( const p of net.flure ) {
        const result:PointDescriptor[] = []
        
        for( const point of p[1] ) {
            if( point == null ) {
                continue;
            }
            if( point.id.startsWith("0-") && !whitelisted.has(point.id) ) {
                // skip most global net points, they do not contribute to the shape
                continue;
            }
            const absolutePoint = points.get(point.id);
            if( !absolutePoint || !absolutePoint.isAbsolute() ) {
                consola.warn("Fehlender Punkt in Flurberechnung", p[0]);
                continue;
            }
            result.push(absolutePoint);
            
        }
        const c = new mapWriter.CalculatedFlur(p[0], result);
        calculatedAreas.push(c);
    }
    return calculatedAreas;
}

function calculateBuildings(registry:parzellenReader.ParzellenRegistry, points:Map<String,PointDescriptor>):mapWriter.CalculatedBuilding[] {
    const calculatedBuildings:mapWriter.CalculatedBuilding[] = [];
    for( const p of registry.all() ) {
        for( const a of p.gebaeude ) {
            const c = new mapWriter.CalculatedBuilding(p.gemeinde, p.flur, p.nr,a.bezeichnung,optimizeHnr(a.hnr));
            c.validFrom = p.validFrom;
            c.validTill = p.validTill;
            c.fortschreibung = p.changeset

            for( const point of a.points ) {
                const absolutePoint = points.get(point.id);
                if( !absolutePoint || !absolutePoint.isAbsolute() ) {
                    consola.warn("Fehlender Punkt in Gebäudeberechnung", p.id());
                    continue;
                }
                c.points.push(absolutePoint);
            }

            calculatedBuildings.push(c);
        }
    }
    return calculatedBuildings;
}

export function optimizeHnr(hnr:string) {
    if( !hnr ) {
        return hnr;
    }

    hnr = hnr.split(' 1/2').join('½');
    hnr = hnr.split(' 1/3').join('⅓');
    hnr = hnr.split(' 2/3').join('⅔');
    hnr = hnr.split(' 1/4').join('¼');
    hnr = hnr.split(' 3/4').join('¾');
    hnr = hnr.split(' 1/8').join('⅛');

    return hnr;
}

async function doWritePoints(points:Map<string,PointDescriptor>, onlyGemeinde:gemeindeType.GemeindeId, onlyNetPoints:boolean):Promise<void> {
    const toBeWritten:PointDescriptor[] = [];
    for( const p of points.values() ) {
        if( onlyGemeinde != null && (p.gemeinde == null || p.gemeinde.getId() != onlyGemeinde.getId()) ) {
            continue;
        }
        if( onlyNetPoints && p.type != PointType.NET && p.type != PointType.NET_MERIDIAN && p.type != PointType.HELPER ) {
            continue
        }
        if( p instanceof AbsolutePointDescriptor || p instanceof MultiWayPointDescriptor) {
            toBeWritten.push(p);
        }
        else if( !p.isAbsolute() ) {
            consola.warn(`Punkt ${p.id} wurde nicht berechnet`);
        }
    }
    await mapWriter.writePoints(toBeWritten);
    consola.success(toBeWritten.length+" Punkte geschrieben")
}

function calculateNet(net:netReader.NetPoints):Map<string,PointDescriptor> {
    const points:Map<string, PointDescriptor> = new Map(net.points);
    if( !calculatePoints(points, true) ) {
        calculatePoints(points, false);
    }

    return points;
}

export async function generateMetadata() {
    await mapWriter.cleanupMetadata();

    consola.start("Schreibe Admin-Metadaten (DB)");
    await mapWriter.writeMetadataFluren(gemeindeType.FLURE);
    await mapWriter.writeMetadataGemeinden(gemeindeType.GEMEINDEN.filter(g => g.isPartsDone()));
    await mapWriter.writeMetadataBuergermeistereien(gemeindeType.BUERGERMEISTEREIEN.filter(b => b.isPartsDone()));
    await mapWriter.writeMetadataKreise(gemeindeType.KREISE.filter(k => k.isPartsDone()));

    consola.start("Erzeuge Admin-Flächen")
    await mapWriter.generateAdminAreas()
    
    consola.start("Schreibe Admin-Metadaten (JSON)");
    await metadataJsonWriter.writeMetadataAdminJson(gemeindeType.KREISE, gemeindeType.BUERGERMEISTEREIEN, gemeindeType.GEMEINDEN, gemeindeType.FLURE);

    consola.start("Schreibe Bezeichnungen (JSON)");
    const bezeichnungen = await mapReader.readBezeichnungen();
    const strassen = await mapReader.readStrassen();
    const buildings = await mapReader.readImportantBuildings();
    await metadataJsonWriter.writeMetadataBezeichnungenJson(bezeichnungen,strassen, buildings);

    consola.start("Schreibe alle Eigentümer (JSON)");
    const eigentuemer = await mutterrolle.getAllEigentuemer();
    checkEigentuemerComplete(eigentuemer);
    await metadataJsonWriter.writeMutterrollenEigentuemer(eigentuemer);

    consola.start("Schreibe Mutterrollen (JSON)");

    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        const mutterrollen = await mutterrolle.getAllMutterrollen(gemeinde);
        if( mutterrollen.length > 0 ) {
            await metadataJsonWriter.writeMutterrollen(gemeinde, mutterrollen);
        }
        else if( gemeinde.isPartsDone() ) {
            throw "Mutterrolle für Gemeinde "+gemeinde.getId()+" erwartet";
        }
    }

    const allParzellen:mapReader.Parzelle[] = []
    consola.start("Schreibe Parzellen pro Gemeinde (JSON)");
    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        for( const flur of gemeinde.getFlure() ) {
            if( flur.isDone() ) {
                const parzellen = await mapReader.readParzellen(gemeinde, flur.getId());
                allParzellen.push(...parzellen)
                await metadataJsonWriter.writeMetadataParzellen(gemeinde, flur.getId(), parzellen);
            }
        }
    }

    consola.start("Schreibe Häuserbücher pro Gemeinde (JSON)");
    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        if( gemeinde.isPartsDone() ) {
            await metadataJsonWriter.writeMetadataHaeuserbuch(gemeinde, allParzellen)
        }
    }

    consola.start("Schreibe alle Parzellen (JSON)");
    await metadataJsonWriter.writeMetadataAllParzellen(allParzellen)
}

function checkEigentuemerComplete(eigentuemer:mutterrolle.Mutterrolle[]):void {
    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        if( gemeinde.isPartsDone() && !eigentuemer.find(e => e.gemeinde.getId() == gemeinde.getId())) {
            throw "Eigentuemer in Gemeinde "+gemeinde.getId()+" erwartet";
        }
    }
}

export async function generateNet() {
    await mapWriter.cleanupPointsOfType(PointType.NET);
    await mapWriter.cleanupPointsOfType(PointType.NET_MERIDIAN);
    await mapWriter.cleanupFlure();

    consola.start("Lese Vermessungspunkte");

    const net = await netReader.readNetPoints();
    const netPoints = calculateNet(net);

    consola.start("Berechne...");
    calculatePoints(netPoints, false);

    await doWritePoints(netPoints, null, true);
    consola.success(netPoints.size, "Punkte geschrieben")
    
    consola.start("Berechne Fluren...");

    const calculatedFluren:mapWriter.CalculatedFlur[] = calculateFluren(net, netPoints);
    await mapWriter.writeFluren(calculatedFluren);
    consola.success(calculatedFluren.length, "Fluren geschrieben");
}

export async function generateMap(gemeinde:gemeindeType.GemeindeId, writeAllPoints:boolean):Promise<void> {
    if( gemeinde == null ) {
        await mapWriter.cleanUp();
    }
    else {
        await mapWriter.cleanUpGemeinde(gemeinde);
    }
    
    consola.start("Lese vorverarbeitete Parzellen");

    const registry = await parzellenReader.readParzellen(gemeinde);
    consola.success(`${registry.all().length} vorverarbeitete Parzellen gelesen`)
    const net = await netReader.readNetPoints();
    const netPoints = calculateNet(net);
    const points = new Map<string,PointDescriptor>([...netPoints,...registry.allPoints()]);

    consola.start("Berechne Punkte...");

    calculatePoints(points, false);

    consola.start(`Schreibe ${writeAllPoints ? 'alle ' : ''}Punkte...`);

    await doWritePoints(points, gemeinde, !writeAllPoints);

    consola.start("Berechne Parzellen...");
    const calculatedAreas:mapWriter.CalculatedArea[] = calculateAreas(registry, points);
    consola.start("Schreibe Parzellen...");
    await mapWriter.writeAreas(calculatedAreas);
    consola.success(calculatedAreas.length, "Parzellen geschrieben")

    consola.start("Berechne Gebäude");
    const calculatedBuildings:mapWriter.CalculatedBuilding[] = calculateBuildings(registry, points);
    await mapWriter.writeBuildings(calculatedBuildings);
    consola.success(calculatedBuildings.length, "Gebäude geschrieben")

    consola.start("Berechne Fluren");
    const calculatedFluren:mapWriter.CalculatedFlur[] = calculateFluren(net, points);
    await mapWriter.writeFluren(calculatedFluren);
    consola.success(calculatedFluren.length, "Fluren geschrieben")
    
    if( gemeinde != null ) {
        await generateUrkatasterInfo(gemeinde);
    }
    else {
        for( const g of gemeindeType.GEMEINDEN ) {
            if( g.isPartsPlanned() ) {
                await generateUrkatasterInfo(g)
            }
        }
    }

    const reader = await createRawDataReader()
    try {
        consola.start("Schreibe Lageangaben")
        const bezeichnungen = await reader.readBezeichnungen(gemeinde)
        await mapWriter.writeBezeichnungen(bezeichnungen)
        consola.success(bezeichnungen.length, "Lageangaben geschrieben")

        consola.start("Schreibe Straßen")
        const strassen = await reader.readStrassen(gemeinde)
        await mapWriter.writeStrassen(strassen)
        consola.success(strassen.length, "Straßen geschrieben")
    }
    finally {
        reader.close()
    }

    if( gemeinde == null ) {
        await generateMetadata();
    }
}

function calculatePoints(points:Map<string,PointDescriptor>, strict:boolean):boolean {
    let changed:boolean;
    let needsCalculation:boolean;

    do {
        needsCalculation = false;
        changed = false;

        for( const p of points.values() ) {
            if( !p.isAbsolute() ) {
                const newP = pointCalculator.calculatePoint(p, points, strict);
                if( newP != null ) {
                    changed = true;
                    points.set(newP.id, newP);
                }
                else {
                    needsCalculation = true;
                }
            }
        }
    } while(needsCalculation && changed)

    return !needsCalculation;
}
