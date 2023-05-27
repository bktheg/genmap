import {AreaTyp} from '#kataster/parzellenReader';
import * as fs from 'fs'
import * as flurbuchReader from '#kataster/flurbuchReader'
import * as gemeindeType from '#kataster/gemeindeType'
import { consola } from 'consola';
import {Parzelle, ParzellenRegistry} from '#kataster/parzellenRegistry'
import { createRawDataReader } from '#kataster/rawDataReader';

const katasterPath = process.env.KATASTER_PATH


type ReducePointCandidate = {
    parzelle:Parzelle;
    coordDescriptor:any[];
    id:string;
}

function buckets(coord:number[]):string[] {
    let x = [Math.floor(coord[1]-0.2), Math.ceil(coord[1]+0.2)];
    let y = [Math.floor(coord[2]-0.2), Math.ceil(coord[2]+0.2)];

    if( x[0] == x[1] ) {
        if( y[0] == y[1] ) {
            return [`${x[0]}_${y[0]}`];
        }
        return [`${x[0]}_${y[0]}`,`${x[0]}_${y[1]}`];
    }
    if( y[0] == y[1] ) {
        return [`${x[0]}_${y[0]}`,`${x[1]}_${y[0]}`];
    }
    return [`${x[0]}_${y[0]}`,`${x[0]}_${y[1]}`,`${x[1]}_${y[0]}`,`${x[1]}_${y[1]}`];
}

function reduceAreas(parzellen:Parzelle[]):void {
    for( const p of parzellen ) {
        if( p.area.length == 1 ) {
            p.typ = p.area[0].type;
        }
        else if( p.area.length == 2 ) {
            const a1 = p.area[0];
            const a2 = p.area[1];
            if( a1.points.length != a2.points.length ) {
                continue;
            }

            // TODO: Better comparison
            const a1Points = [].concat.apply([], a1.points);
            const a2Points = [].concat.apply([], a2.points);
            if( a1Points.length != a2Points.length ) {
                continue;
            }

            let equal = true;
            for( const p1 of a1Points ) {
                let found = true;
                for( const p2 of a2Points ) {
                    if( p2[0] != "REF" ) {
                        // Assume REF -> Reference to first poly
                        found = false;
                        break;
                    }
                }
                if( !found ) {
                    equal = false;
                    break;
                }
            }
            if( equal ) {
                p.area = [a1];
                if( !a1.type || a1.type == AreaTyp.Default) {
                    p.typ = a2.type;
                }
                else {
                    p.typ = a1.type;
                }
                a1.type = AreaTyp.Default;
            }
        }
    }
}

function enrichAreaTypes(parzellen:Parzelle[]):void {
    for( const p of parzellen ) {
        const flurbuchEntry = flurbuchReader.loadEntry(p.gemeinde, p.flur, p.nr);
        
        const actualAreaTypes:Set<AreaTyp> = new Set();
        for( const a of p.area ) {
            if( a.rawtype ) {
                actualAreaTypes.add(flurbuchReader.mapType(p.gemeinde, p.flur, a.rawtype)[0] || a.type);
            }
            else {
                actualAreaTypes.add(a.type);
            }
        }
        let actualCount = actualAreaTypes.size;
        // TODO: There might still be an undetected type missmatch (e.g. Default+Wasser vs Wiese[+Wasser])
        if( flurbuchEntry && !flurbuchEntry.typ.includes(AreaTyp.Default) && actualAreaTypes.has(AreaTyp.Default) ) {
            // Filter default Type for base shape
            actualCount--;
        }

        if( flurbuchEntry && flurbuchEntry.typ.length == 1 && actualCount <= 1 ) {
            p.typ = flurbuchEntry.typ[0];
        }
        else if( flurbuchEntry ) {
            // sanity check
            let typesOk = true;
            for(const typEntry of flurbuchEntry.typ ) {
                if( !actualAreaTypes.has(typEntry) ) {
                    typesOk = false;
                    break;
                }
            }
            if( !typesOk ) {
                try {
                    consola.warn("Bitte Kulturarten der Parzelle "+p.id()+" prüfen. Erwartet "+areaTypesToString(flurbuchEntry.typ)+" ist "+areaTypesToString(actualAreaTypes.values()));
                }
                catch( error ) {
                    consola.error("Bitte Kulturarten der Parzelle "+p.id()+" prüfen. Mappingfehler.", error);
                }
            }
            else if( actualCount != flurbuchEntry.typ.length ) {
                consola.debug("Zusätzliche Kulturarten für Parzelle "+p.id()+" erfasst. Erwartet "+areaTypesToString(flurbuchEntry.typ)+" ist "+areaTypesToString(actualAreaTypes.values()));
            }
        }
    }
}

function areaTypesToString(types:Iterable<AreaTyp>):string[] {
    const result:string[] = [];

    for( const t of types ) {
        switch(t) {
            case AreaTyp.Acker:
                result.push("Acker");
                break;
            case AreaTyp.Default:
                result.push("Default");
                break;
            case AreaTyp.Friedhof:
                result.push("Friedhof");
                break;
            case AreaTyp.Garten:
                result.push("Garten");
                break;
            case AreaTyp.Gruenflaeche:
                result.push("Gruenflaeche");
                break;
            case AreaTyp.Hofraum:
                result.push("Hofraum");
                break;
            case AreaTyp.Holzung:
                result.push("Holzung");
                break;
            case AreaTyp.Wasser:
                result.push("Wasser");
                break;
            case AreaTyp.Weide:
                result.push("Weide");
                break;
            case AreaTyp.Wiese:
                result.push("Wiese");
                break;
            case AreaTyp.Grube:
                result.push("Grube");
                break;
            default:
                throw new Error("Unknown AreaTyp "+t);
        }
    }
    return result;
}

function reducePoints(parzellen:Parzelle[]):void {
    const map = new Map<string,ReducePointCandidate[]>();

    for( const p of parzellen ) {
        let aIdx = 0;
        for( const a of p.area ) {
            for( const r of a.points ) {
                for( const c of a.points ) {
                    aIdx++;
                    if( c[0] != "ABS" ) {
                        continue;
                    }

                    const candidate:ReducePointCandidate = {
                        parzelle: p,
                        coordDescriptor: c,
                        id: `F-${p.id()}-${aIdx}`
                    }

                    for( const key of buckets(c) ) {
                        if( !map.has(key) ) {
                            map.set(key, []);
                        }
                        map.get(key).push(candidate);
                    }
                }
            }
        }
    }

    for( const candidates of map.values() ) {
        for( let i=0; i < candidates.length; i++ ) {
            for( let j=i+1; j < candidates.length; j++ ) {
                const c1 = candidates[i];
                const c2 = candidates[j];

                if( c1.coordDescriptor[0] == "ABS" && c2.coordDescriptor[0] == "ABS" &&
                        Math.abs(c1.coordDescriptor[1]-c2.coordDescriptor[1]) < 0.2 && 
                        Math.abs(c1.coordDescriptor[2]-c2.coordDescriptor[2]) < 0.2 ) {
                    if( c1.parzelle.nr < c2.parzelle.nr ) {
                        c2.coordDescriptor[0] = "REF";
                        c2.coordDescriptor[1] = c1.id
                        c2.coordDescriptor[2] = null;
                    }
                    else {
                        c1.coordDescriptor[0] = "REF";
                        c1.coordDescriptor[1] = c2.id
                        c1.coordDescriptor[2] = null;
                    }
                }
            }
        }
    }
}

export async function generateAutoLayer(gemeinde:gemeindeType.GemeindeId) {
    const parzellen = new ParzellenRegistry();
    const dataReader = createRawDataReader();
    try {
        await dataReader.readKatasterParzellen(parzellen, gemeinde);
        await dataReader.readKatasterGebaeude(parzellen, gemeinde);
    }
    finally {
        dataReader.close()
    }
    reduceAreas([...parzellen.values()]);
    enrichAreaTypes([...parzellen.values()]);
    reducePoints([...parzellen.values()]);

    const basePath = `${katasterPath}/auto`;

    let counter = 0
    for( const p of parzellen.values() ) {
        if( !fs.existsSync(basePath+"/"+p.gemeinde.getId()) ) {
            fs.mkdirSync(basePath+"/"+p.gemeinde.getId());
        }
        if( !fs.existsSync(basePath+"/"+p.gemeinde.getId()+"/"+p.flur) ) {
            if( p.gemeinde.getFlur(p.flur) == null ) {
                consola.warn("Flur unbekannt, überspringe:", p.id());
                continue;
            }
            fs.mkdirSync(basePath+"/"+p.gemeinde.getId()+"/"+p.flur);
        }
        if( p.flur == null ) {
            consola.warn("Flur leer, überspringe");
            continue;
        }
        if( p.nr == '?' || p.nr == null ) {
            consola.warn("Unbekannte Parzelle ", p.id(), ", überspringe");
            continue;
        }
        if( p.nr && p.nr != 'none' && !flurbuchReader.loadEntry(p.gemeinde, p.flur, p.nr) ) {
            consola.warn("Überspringe Parzelle", p.id(), " Die Parzelle fehlt im Flurbuch")
            continue
        }
        fs.writeFileSync(basePath+"/"+p.gemeinde.getId()+"/"+p.flur+"/"+p.nr+".json", JSON.stringify(p.export(), null, 4));
        counter++
    }
    consola.success(counter, "vorverarbeitete Parzellen geschrieben")
}