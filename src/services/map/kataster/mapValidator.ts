import * as database from '#utils/database'
import * as mapReader from '#kataster/mapReader'
import {PointDescriptor} from '#kataster//pointDescriptors'
import { Zeit } from '#utils/zeit';
import * as gemeindeType from '#kataster/gemeindeType'
import * as flurbuchReader from '#kataster/flurbuchReader'
import * as fs from 'fs'
import * as mutterrolleNameListReader from '#kataster/mutterrolleNameListReader'
import * as unitConversion from '#kataster/unitConversion'
import { MutterrolleTaxeKulturart } from '#kataster/mutterrolleNameListReader';
import { NumberRangeMatcher } from '#kataster/numberRangeMatcher';
import { lookupTaxierung } from '#kataster/kulturartenReader';
import { consola } from 'consola';

const katasterPath = process.env.KATASTER_PATH

class DbArea {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string, public area:number) {}

    id():string {
        return this.gemeinde.getId()+"-"+this.flur+"-"+this.nr;
    }
}

async function readDbAreas(gemeinde:gemeindeType.GemeindeId):Promise<Map<string,DbArea>> {
    const areas = await database.getClient().query({
        text: `SELECT a.gemeinde as gemeinde,a.flur as flur,a.nr as parzelle,ST_AREA(the_geom) as area FROM kataster_gen_areas a WHERE yearfrom<=1825 AND yeartill>=1825 AND typ=0 AND gemeinde=$1`, 
        values: [gemeinde.getId()]
    })

    const map = new Map<string,DbArea>();
    for( const r of areas.rows ) {
        const id = `${r.gemeinde}-${r.flur}-${r.parzelle}`;
        if( map.has(id) ) {
            const area = map.get(id);
            area.area += r.area;
        }
        else {
            map.set(id, new DbArea(gemeindeType.forId(r.gemeinde), r.flur, r.parzelle, r.area));
        }
    }
    return map;
}


export async function validateMap() {
    consola.start("Validiere Parzellengeometrien")
    const result = new ValidationResult();
    for( const gem of gemeindeType.GEMEINDEN ) {
        result.add(await validateParzellenArea(gem));
    }
    result.add(await validateParzellenGeometry())
    result.add(await validateOverlappingParzellen())

    consola.start("Validiere Flurbuch-Parzellen")
    
    result.add(validateSizesAgaintOwnerList());
    for( const gem of gemeindeType.GEMEINDEN ) {
        result.add(validateFlurbuchSummen(gem));
        result.add(validateSizeAgainstReinertrag(gem));
    }

    consola.start("Validiere Gebäude")
    result.add(await validateGebaeudeInsideParzelle())

    try {
        writeValidationResult(result);
    }
    catch(exception) {
        consola.error("Fehler bein Schreiben der Validierungsergebnisse:", exception);
    }
    consola.success("Validierung abgeschlossen");
}

async function validateGebaeudeInsideParzelle():Promise<ValidationResult> {
    consola.debug("Validiere alle Gebäude liegen innerhalb ihrer Parzelle")

    const result = new ValidationResult();

    const query = await database.getClient().query({
        text: `SELECT b.gemeinde as gemeinde,b.flur as flur,b.nr as nr,b.id as id
                FROM kataster_gen_buildings as b 
                WHERE b.nr!='none' and not exists (SELECT a.id FROM kataster_gen_areas as a WHERE a.typ=0 and a.gemeinde=b.gemeinde and a.flur=b.flur and a.nr=b.nr and ST_COVERS(a.the_geom,b.the_geom));`, 
    })

    for( const r of query.rows ) {
        result.logMessage(gemeindeType.forId(r.gemeinde), r.flur, r.nr, `Das Gebäude mit der ID ${r.id} liegt (teilweise) außerhalb seiner Parzelle oder es wurden nicht alle Eckpunkte richtig erfasst`)
    }
    return result
}

async function validateParzellenGeometry():Promise<ValidationResult> {
    consola.debug("Validiere Parzellen haben eine valide Geometrie")

    const result = new ValidationResult();

    const query = await database.getClient().query({
        text: `SELECT DISTINCT a.gemeinde as gemeinde,a.flur as flur,a.nr as nr
                FROM kataster_gen_areas as a
                WHERE NOT ST_ISVALID(a.the_geom);`, 
    })

    for( const r of query.rows ) {
        result.logMessage(gemeindeType.forId(r.gemeinde), r.flur, r.nr, `Die Parzelle hat eine ungültige Geometrie`)
    }
    return result
}

async function validateOverlappingParzellen():Promise<ValidationResult> {
    consola.debug("Validiere keine Parzelle überlappt eine andere Parzelle")

    const result = new ValidationResult();

    const query = await database.getClient().query({
        text: `SELECT a.gemeinde as gemeinde,a.flur as flur,a.nr as nr,
                    (SELECT STRING_AGG(CONCAT(a2.gemeinde,'-',a2.flur,'-',a2.nr),', ') FROM kataster_gen_areas as a2 WHERE a2.typ=0 and a.id!=a2.id and fortschreibung is null and ST_ISVALID(a2.the_geom) and ST_OVERLAPS(a.the_geom,a2.the_geom)) as overlapping
                FROM kataster_gen_areas as a
                WHERE a.typ=0 and ST_ISVALID(a.the_geom) 
                    and a.fortschreibung is null
                    and exists (SELECT a2.id FROM kataster_gen_areas as a2 WHERE a2.typ=0 and a.id!=a2.id and fortschreibung is null and ST_ISVALID(a2.the_geom) and ST_OVERLAPS(a.the_geom,a2.the_geom));`, 
    })

    for( const r of query.rows ) {
        result.logMessage(gemeindeType.forId(r.gemeinde), r.flur, r.nr, `Die Parzelle überlappt mindestens eine andere Parzelle (${r.overlapping})`)
    }
    return result
}

function validateSizeAgainstReinertrag(gemeinde:gemeindeType.GemeindeId):ValidationResult {
    consola.debug("Validiere Reinerträge der Parzellen gegen nachgerechnete Reinerträge für Gemeinde", gemeinde.getId())

    const result = new ValidationResult();

    const taxen = mutterrolleNameListReader.readTaxen(gemeinde);
    if( !taxen ) {
        if( gemeinde.getFlure().some(f => f.isPlanned()) ) {
            result.logMessage(gemeinde, null, null, 'Keine Taxen für Flächen hinterlegt')
        }
    }

    for( const flur of gemeinde.getFlure() ) {
        if( !flurbuchReader.hasFlurbuch(gemeinde, flur.getId()) ) {
            continue;
        }
        
        const entries = flurbuchReader.loadAllEntries(gemeinde, flur.getId());
        for( const parzelle of entries.parzellen.values() ) {
            for( const subrow of parzelle.subrows.length ? parzelle.subrows : [parzelle] ) {
                if( !subrow.klasse ) {
                    continue;
                }
                const klasse = parseAndValidateKlasse(result, subrow)

                if( subrow.reinertrag == null || subrow.reinertrag.isZero() || !taxen ) {
                    continue
                }

                const expectedTaxPerMorgen = subrow.reinertrag.div(subrow.areaTaxable.add(subrow.areaNonTaxable).getTotalMorgen()).toString()
                let taxenKulturart:MutterrolleTaxeKulturart|null
                try {
                    taxenKulturart = kulturartToTaxenKulturart(subrow.typPlain);
                }
                catch( e ) {
                    result.logMessage(gemeinde, flur.getId(), parzelle.nr, `Keine Taxen-Kulturart für Kulturart ${subrow.typPlain} gefunden. Aktueller Wert entspricht Satz ${expectedTaxPerMorgen}`)
                    continue
                }

                if( taxenKulturart == null || klasse == null ) {
                    continue
                }

                const estimatedReinertrag = [...klasse.entries()]
                    .map(e => taxen.getTaxe(taxenKulturart, flur.getId(), e[0]).mul(e[1].getTotalMorgen()))
                    .reduce((a,b) => a.add(b));

                const delta = Math.abs(estimatedReinertrag.getTotalPfennig()-subrow.reinertrag.getTotalPfennig())
                if( delta > 9 ) {
                    const individualValues = [...klasse.entries()]
                        .map(e => "Klasse "+e[0]+": "+e[1].toString()+" = "+taxen.getTaxe(taxenKulturart, flur.getId(), e[0]).mul(e[1].getTotalMorgen()))
                        .join(', ')
                    result.logMessage(
                        gemeinde, 
                        flur.getId(), 
                        parzelle.nr, 
                        'Reinertrag passt nicht zum berechneten Wert. Berechnet wurde '+individualValues+' summiert '+estimatedReinertrag.toString()+'. '+
                        'Abweichung '+new unitConversion.Money(0,0,delta).rebalance().toString()+'. '+
                        'Aktueller Wert entspricht Satz '+expectedTaxPerMorgen
                    );
                }
            }
        }
    }

    return result;
}

function parseAndValidateKlasse(result:ValidationResult, parzelle:flurbuchReader.Parzelle):Map<number,unitConversion.Area> {
    const klassenMap = new Map<number,unitConversion.Area>()
    if( parzelle.klasse.match(/^[0-9]+$/) ) {
        const klasse = parseInt(parzelle.klasse);
        if( klasse < 1 || klasse > 5 ) {
            result.logMessage(parzelle.gemeinde, parzelle.flur, parzelle.nr, 'Ungültige Klasse: '+parzelle.klasse);
            return null
        }
        klassenMap.set(klasse, parzelle.areaNonTaxable.add(parzelle.areaTaxable))
    }
    else {
        const regex = /^([0-9/\.]+[mrf]\=[1-5])([\s]+[0-9/\.]+[mrf]\=[1-5])?([\s]+[0-9/\.]+[mrf]\=[1-5])?([\s]+[0-9/\.]+[mrf]\=[1-5])?\srest\s([1-5])$/
        const matches = parzelle.klasse.match(regex)
        if( !matches ) {
            result.logMessage(parzelle.gemeinde, parzelle.flur, parzelle.nr, 'Ungültige Klasse: '+parzelle.klasse);
            return null
        }
        
        let remainingArea = parzelle.areaTaxable.add(parzelle.areaNonTaxable)
        for( const entry of [matches[1],matches[2], matches[3], matches[4]] ) {
            if( !entry ) {
                continue
            }
            const parts = entry.trim().split('=')
            if( parts.includes('/') ) {
                // TODO Not supported yet
                return null;
            }
            const unit = parts[0].charAt(parts[0].length-1)
            let areaParts = parts[0].substring(0, parts[0].length-1).split('.')
            if( unit == 'r' ) {
                areaParts = ['0', ...areaParts]
            }
            else if( unit == 'f' ) {
                areaParts = ['0', '0', ...areaParts]
            }
            while( areaParts.length < 3 ) {
                areaParts.push('0')
            }
            if( areaParts.length > 3 ) {
                result.logMessage(parzelle.gemeinde, parzelle.flur, parzelle.nr, 'Ungültige Klasse: '+parzelle.klasse);
                return null
            }

            const areaOfPart = unitConversion.parseMorgenRutenFuss(areaParts.join('.'))
            remainingArea = remainingArea.subtract(areaOfPart)
            klassenMap.set(parseInt(parts[1]), areaOfPart)
        }

        if( remainingArea.getTotalFuss() < 0 ) {
            result.logMessage(parzelle.gemeinde, parzelle.flur, parzelle.nr, 'Ungültige Klasse: '+parzelle.klasse+'. Restfläche ist negativ');
            return null
        }

        klassenMap.set(parseInt(matches[5]), remainingArea)
    }
    return klassenMap
}

function kulturartToTaxenKulturart(kulturart:string):MutterrolleTaxeKulturart {
    if( !kulturart ) {
        return null;
    }
    if( kulturart.includes(' u. ') || kulturart.includes(' und ') || kulturart.includes(',') ) {
        // not supported (yet)
        return null;
    }

    if( kulturart.includes('=') ) {
        const parts = kulturart.split('=')
        kulturart = parts[parts.length-1];
    }

    const taxierung = lookupTaxierung(kulturart)
    if( taxierung == null ) {
        consola.warn('Keine Taxen-Kulturart für Kulturart '+kulturart+' gefunden');
        throw new Error('Keine Taxen-Kulturart für Kulturart '+kulturart+' gefunden')
    }
    return taxierung
}

class OwnerParzellenEntry {
    constructor(public totalArea=new unitConversion.Area(0,0,0), public totalErtrag=new unitConversion.Money(0,0,0), public parzellen:flurbuchReader.Parzelle[]=[]) {}

    public addParzelle(parzelle:flurbuchReader.Parzelle):void {
        this.parzellen.push(parzelle)
        this.totalArea = this.totalArea.add(parzelle.areaTaxable).add(parzelle.areaNonTaxable)
        if( parzelle.reinertrag != null ) {
            this.totalErtrag = this.totalErtrag.add(parzelle.reinertrag)
        }
    }
}

function validateSizesAgaintOwnerList():ValidationResult {
    consola.debug("Validiere Größen und Erträge gegen Summen aus Mutterrolle")

    const result = new ValidationResult();

    for( const gem of gemeindeType.GEMEINDEN ) {
        const gemeindeErtraege = new Set<string>();
        const ownerMap = new Map<string,OwnerParzellenEntry>()
        const ownersToBeChecked = new Set<string>()

        for( const flur of gem.getFlure() ) {
            if( !flurbuchReader.hasFlurbuch(gem, flur.getId()) ) {
                if( flur.isPlanned() ) {
                    result.logMessage(gem, flur.getId(), null, 'Kein Flurbuch gefunden');
                }
                continue;
            }
            const flurbuch = flurbuchReader.loadAllEntries(gem, flur.getId())

            for( const p of flurbuch.parzellen ) {
                const parzelle = p[1];
                
                if( !ownerMap.has(parzelle.mutterrolle) ) {
                    ownerMap.set(parzelle.mutterrolle, new OwnerParzellenEntry());
                }
                ownerMap.get(parzelle.mutterrolle).addParzelle(parzelle)
                ownersToBeChecked.add(parzelle.mutterrolle)

                if( parzelle.reinertrag != null && !parzelle.reinertrag.isZero() ) {
                    gemeindeErtraege.add(parzelle.gemeinde.getId());
                }
            }
        }

        consola.debug(ownerMap.size,"Eigentümer in Flurbüchern der Gemeinde",gem.getId(), "gefunden.")
    
        const ownerList = mutterrolleNameListReader.readGemeinde(gem);
        for( const owner of ownerList.values() ) {
            if( owner.area == null ) {
                continue;
            }

            ownersToBeChecked.delete(owner.artikel)

            const ownerEntry = ownerMap.get(owner.artikel);
            if( !ownerEntry ) {
                if( !owner.area.isZero() ) {
                    result.logMessage(owner.gemeinde, null, null, `Keine Flächen gefunden für Artikel ${owner.artikel}`);
                }
            }
            else if( !ownerEntry.totalArea.equals(owner.area) ) {
                let message = `Abweichung Fläche Artikel ${owner.artikel}. Erwartet: ${owner.area.toString()} Ist: ${ownerEntry.totalArea.toString()}`
                const diff = ownerEntry.totalArea.subtract(owner.area)
                if( diff.getTotalFuss() > 0 ) {
                    const match = ownerEntry.parzellen.find(p => p.areaNonTaxable.add(p.areaTaxable).equals(diff))
                    if( match ) {
                        message += `. Bitte Parzelle ${match.id()} prüfen.`
                    }
                }
                result.logMessage(owner.gemeinde, null, null, message);
                
            }

            if( !ownerEntry ) {
                if( gemeindeErtraege.has(owner.gemeinde.getId()) && !owner.reinertrag.isZero() ) {
                    result.logMessage(owner.gemeinde, null, null, `Kein Reinertrag gefunden für Artikel ${owner.artikel}`);
                }
            }
            else if( !ownerEntry.totalErtrag.equals(owner.reinertrag) ) {
                if( gemeindeErtraege.has(owner.gemeinde.getId()) && !owner.reinertrag.isZero() ) {
                    result.logMessage(owner.gemeinde, null, null, `Abweichung Reinertrag Artikel ${owner.artikel}. Erwartet: ${owner.reinertrag.toString()} Ist: ${ownerEntry.totalErtrag.toString()}`);
                }
            }
        }

        if( ownerList.size > 0 ) {
            for( const artikel of ownersToBeChecked ) {
                for( const parzelle of ownerMap.get(artikel).parzellen ) {
                    result.logMessage(gem, parzelle.flur, parzelle.nr, `Eigentümer ohne Eintrag in Mutterrolle (Artikel ${artikel})`)
                }
            }
        }
        else {
            result.logMessage(gem, null, null, 'Summen aus Mutterrolle fehlen')
        }
    }

    return result;
}

async function validateParzellenArea(gemeinde:gemeindeType.GemeindeId):Promise<ValidationResult> {
    const currentAreas:Map<string,DbArea> = await readDbAreas(gemeinde);
 
    const flurSet = new Set<number>();
    const parzelleShould:flurbuchReader.Parzelle[] = []
    const parzelleActual = new Set<string>();
    const result = new ValidationResult();

    for( const area of currentAreas.values() ) {
        if( area.nr == 'none' ) {
            result.logMessage(area.gemeinde, area.flur, area.nr, `Parzelle nicht zugeordnet`);
        }
        
        if( !area.nr || area.nr == "none" ) {
            continue;
        }
        const entry = flurbuchReader.loadEntry(area.gemeinde, area.flur, area.nr);
        if( !entry ) {
            result.logMessage(area.gemeinde, area.flur, area.nr, `Kein Eintrag im Flurbuch`);
            continue;
        }
        if( !flurSet.has(area.flur) ) {
            parzelleShould.push(...flurbuchReader.loadAllEntries(area.gemeinde, area.flur).parzellen.values());
            flurSet.add(area.flur);
        }

        parzelleActual.add(area.id());

        if( entry.areaTaxable.isZero() && entry.areaNonTaxable.isZero() ) {
            continue;
        }
        if( !entry.areaTaxable.isZero() && !entry.areaNonTaxable.isZero() ) {
            result.logMessage(area.gemeinde, area.flur, area.nr, `Sowohl steuerbare als auch nicht steuerbare Fläche gefüllt. Bitte nur einen der beiden Werte angeben. Werte werden aktuell summiert!`);
        }

        const refSizeInM2 = entry.areaTaxable.add(entry.areaNonTaxable).toMeter2();
        const difference = area.area-refSizeInM2;
        const factor = difference/refSizeInM2;
        if( isHugeAreaDifference(area.area, refSizeInM2) ) {
            result.logMessage(area.gemeinde, area.flur, area.nr, `Abweichung Parzelle zur Flurbuchfläche (${Math.round(factor*100)}%). Ist: ${Math.round(area.area)} m² Soll: ${Math.round(refSizeInM2)} m²`);
        }
    }

    for( const entry of parzelleShould ) {
        if( !parzelleActual.has(entry.id()) ) {
            result.logMessage(entry.gemeinde, entry.flur, entry.nr, `Parzelle fehlt`);
        }
    }
    return result;
}

function validateFlurbuchSummen(gemeinde:gemeindeType.GemeindeId):ValidationResult {
    consola.debug("Validiere Parzellen gegen Summen aus den Flurbüchern für Gemeinde", gemeinde.getId())

    const result = new ValidationResult();

    // Validierung Flurbuch Summen
    for( const flur of gemeinde.getFlure() ) {
        if( !flurbuchReader.hasFlurbuch(gemeinde, flur.getId()) ) {
            continue;
        }
        const flurbuch = flurbuchReader.loadAllEntries(gemeinde, flur.getId());

        const parzellenList = [...flurbuch.parzellen.values()];
        if( parzellenList.some(fs => !fs.lage) ) {
            result.logMessage(gemeinde, flur.getId(), null, 'Fehlende Lageangaben: '+parzellenList.filter(fs => !fs.lage).length+' Parzelle(n)');
        }
        if( parzellenList.some(fs => !fs.klasse) ) {
            result.logMessage(gemeinde, flur.getId(), null, 'Fehlende Klasseangaben: '+parzellenList.filter(fs => !fs.klasse).length+' Parzelle(n)');
        }
        if( parzellenList.some(fs => fs.reinertrag == null) ) {
            result.logMessage(gemeinde, flur.getId(), null, 'Fehlende Reinertragsangaben: '+parzellenList.filter(fs => fs.reinertrag == null).length+' Parzelle(n)');
        }
        if( parzellenList.some(fs => !fs.mutterrolle) ) {
            result.logMessage(gemeinde, flur.getId(), null, 'Fehlende Artikelnummer: '+parzellenList.filter(fs => !fs.mutterrolle).length+' Parzelle(n)');
        }

        if( flurbuch.summen.length == 0 ) {
            result.logMessage(gemeinde, flur.getId(), null, `Keine Summen hinterlegt`);
            continue;
        }

        const parzellenToBeChecked = new Set(flurbuch.parzellen.values());
        for(const summe of flurbuch.summen) {
            let actualArea = new unitConversion.Area(0,0,0);
            let actualReinertrag = new unitConversion.Money(0,0,0);
            let actualAreaFree = new unitConversion.Area(0,0,0);
            for( const entry of flurbuch.parzellen.values() ) {
                if( entry.flur != flur.getId() ) {
                    continue;
                }
                if( isParzelleInRange(entry.nr, summe.start, summe.end) ) {
                    const flurbuchEntry = flurbuchReader.loadEntry(gemeinde, flur.getId(), entry.nr);
                    actualArea = actualArea.add(flurbuchEntry.areaTaxable);
                    actualAreaFree = actualAreaFree.add(flurbuchEntry.areaNonTaxable)
                    actualReinertrag = actualReinertrag.add(flurbuchEntry.reinertrag)
                    parzellenToBeChecked.delete(entry);
                }
            }
            const areaFree = summe.areaFree != null ? summe.areaFree : new unitConversion.Area(0,0,0);
            if( summe.areaFree == null ) {
                actualArea = actualArea.add(actualAreaFree);
            }

            if( actualArea.getTotalFuss() != summe.area.getTotalFuss() ) {
                if( actualArea.add(actualAreaFree).getTotalFuss() != summe.area.getTotalFuss() ) {
                    result.logMessage(gemeinde, flur.getId(), null, `Summendifferenz Flächen Seite ${summe.page}: Soll ${summe.area.toString()} Ist ${actualArea.toString()} (ohne steuerfreie Teile) ${actualArea.add(actualAreaFree).toString()} (mit steuerfreie Teile)`);
                }
            }
            if( actualAreaFree.getTotalFuss() != areaFree.getTotalFuss() ) {
                result.logMessage(gemeinde, flur.getId(), null, `Summendifferenz Flächen Steuerfrei Seite ${summe.page}: Soll ${areaFree.toString()} Ist ${actualAreaFree.toString()}`);
            }

            if( actualReinertrag.getTotalPfennig() > 0 && !actualReinertrag.equals(summe.reinertrag) ) {
                result.logMessage(gemeinde, flur.getId(), null, `Summendifferenz Reinertrag Seite ${summe.page}: Soll ${summe.reinertrag.toString()} Ist ${actualReinertrag.toString()}`);
            }
        }

        if( parzellenToBeChecked.size > 0 ) {
            result.logMessage(gemeinde, flur.getId(), null, `Flurbuch: ${parzellenToBeChecked.size} Parzellen nicht durch Summen abgedeckt`);
        }
    }

    return result;
}

function isParzelleInRange(number:string, start:string, end:string):boolean {
    return start.includes('-') || start.includes(',')
        ? new NumberRangeMatcher(start).matches(number) 
        : new NumberRangeMatcher(`${start}-${end}`, true).matches(number)
}

async function writeValidationResult(result:ValidationResult):Promise<void> {
    const values:ValidationMessage[] = new Array(...result.getMessages())
    values.sort((a, b) => {
        let diff = a.gemeinde.getName().localeCompare(b.gemeinde.getName())
        if( diff != 0 ) {
            return diff
        }
        diff = a.flur-b.flur
        if( diff != 0 ) {
            return diff
        }
        if( a.nr == null ) {
            return b.nr != null ? -1 : 0
        }
        if( b.nr == null ) {
            return 1
        }
        if( a.nr === b.nr ) {
            return 0
        }
        if( a.nr == 'none' ) {
            return -1
        }
        if( b.nr == 'none' ) {
            return 1
        }
        diff = parseInt(a.nr)-parseInt(b.nr)
        if( diff != 0 ) {
            return diff
        }
        diff = `${a.nr}`.localeCompare(`${b.nr}`)
        if( diff != 0 ) {
            return diff
        }
        return a.message.localeCompare(b.message)
    });

    const resultsPerGemeinde = new Map<gemeindeType.GemeindeId,ValidationMessage[]>()
    gemeindeType.GEMEINDEN.forEach(g => resultsPerGemeinde.set(g, []))
    values.forEach(v => resultsPerGemeinde.get(v.gemeinde).push(v))

    for( const [gem, results] of resultsPerGemeinde.entries() ) {
        if( !gem.isPartsPlanned() ) {
            continue
        }
        let file = 'gemeinde;flur;parzelle;meldung\n';
        for( const value of results ) {
            file += `${value.gemeinde.getId()};${value.flur || ''};${value.nr || ''};"${value.message}"`
            file += '\n';
        }
        fs.writeFileSync(`${katasterPath}/out_validation/${gem.getId()}.csv`, file, "ascii");
    }
}   


function isHugeAreaDifference(area:number, refSizeInM2:number):boolean {
    const difference = Math.abs(area-refSizeInM2);
    const factor = difference/refSizeInM2;
    if( difference <= 20 ) {
        return false;
    }
    if( factor > 0.2 ) {
        return true;
    }

    return difference > 1000 && factor > 0.05;
}

class ValidationMessage {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string, public message:string) {}
}

class ValidationResult {
    private messages:ValidationMessage[] = [];

    add(result:ValidationResult):void {
        this.messages.push(...result.getMessages());
    }

    logMessage(gemeinde:gemeindeType.GemeindeId, flur:number, nr:string, message:string):void {
        this.messages.push(new ValidationMessage(gemeinde, flur, nr, message));
    }

    getMessages():ValidationMessage[] {
        return this.messages;
    }
}