import XLSX from 'xlsx'
import * as zeit from '#utils/zeit'
import * as XslxUtils from '#utils/xslxUtils'
import { GemeindeId, forId } from '#kataster/gemeindeType';
import { consola } from 'consola';

const katasterPath = process.env.KATASTER_PATH

export class Building {
    street:string;
    number:string; 
    oldNumber:string;
    infos: Array<BuildingInfo>;
    flur:BuildingInfo;
    yearInfos: Array<BuildingYearInfo>;
}

export enum BuildingInfoType {
    Flur,
    Kataster,
    Groesse,
    Name,
    Unbekannt
}

export type BuildingInfo = {
    type:BuildingInfoType,
    text:string
}

export type BuildingYearInfo = {
    year:zeit.Zeit,
    text:string
}

export class Street {
    name:string;
    buildings:Array<Building> = new Array();
    infos:Array<StreetInfo> = new Array();
}

export type StreetInfo = {
    text:string
}

let LOADED = null as null|Map<GemeindeId,Street[]>

export function loadHaeuserbuchByGemeinde(gemeinde:GemeindeId): Street[] {
    if( !LOADED ) {
        LOADED = loadAll();
    }
    return LOADED.get(gemeinde)
}

function loadAll():Map<GemeindeId,Street[]> {
    const result = new Map<GemeindeId,Street[]>()

    XslxUtils.loadExcelsInPath(`${katasterPath}/häuserbücher`, (path,file) => {
        let gemeinde = file.substring(0, file.indexOf("."));
        const gemeindeParts = gemeinde.split('-');
        let gemeindeId:GemeindeId;
        try {
            gemeindeId = forId(gemeindeParts[gemeindeParts.length-1])
        }
        catch( ex ) {
           throw new Error("Gemeinde nicht gefunden für Netz-Datei: "+file);
        }

        result.set(gemeindeId, load(path+"/"+file))
    })

    return result
}

function load(path:string):Street[] {
    const workbook = XLSX.readFile(path);
   
    let result:Street[] = []
    let currentStreet = null;
    const sheet = workbook.Sheets['Blatt1'];
    let i = 1;
    let skipped = 0;
    let building:Building = null;
    while(true) {
        i++;
        const streetCell = sheet['A'+i];
        const hnrCell = sheet['B'+i];
        const infoCell = sheet['E'+i];
        if( !streetCell && !hnrCell && !infoCell ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        skipped = 0;

        const streetName = readCell(sheet, 'A', i);
        const infotext = readCell(sheet, 'E', i);

        if( streetCell && (currentStreet == null || currentStreet.name != streetName)) {
            currentStreet = new Street();
            currentStreet.name = streetName;
            result.push(currentStreet);
        }
        
        if( streetCell && hnrCell ) {
            building = new Building();
            building.street = streetName;
            building.number =  readCell(sheet, 'B', i);
            building.oldNumber = readCell(sheet, 'C', i);
            building.infos = new Array();
            building.yearInfos = new Array();
            currentStreet.buildings.push(building);
        }

        if( infoCell && streetCell && !hnrCell ) {
            const info:StreetInfo = {
                text: infotext
            };

            currentStreet.infos.push(info);
        }
        else if( infoCell ) {
            let year = readCell(sheet, 'D', i);
            if( !year || year.toLowerCase().startsWith("anm") ) {
                try {
                    const yearInt = parseInt(infotext.substr(0,5).trim());
                    year = yearInt > 1000 && yearInt < 2000 ? ""+yearInt : year;
                }
                catch(ex) {
                    // Ignore, no date
                }
            }

            if( !year || year.toLowerCase().startsWith("anm") ) {
                const info:BuildingInfo = {
                    type: determineInfoType(infotext),
                    text: infotext
                };

                switch(info.type) {
                    case BuildingInfoType.Flur:
                        building.flur = info;
                        break;
                    default:
                        building.infos.push(info);
                }
            }
            else {
                let parsedYear:zeit.Zeit = zeit.parse(year);

                const info:BuildingYearInfo = {
                    year: parsedYear,
                    text: infotext
                };

                building.yearInfos.push(info);
            }
        }
    }
    
    let fullCounter = 0;
    let partialCounter = 0;
    for( let street of result ) {
        for( let geb of street.buildings ) {
            if( geb.yearInfos.length == 0 ) {
                partialCounter++;
            }
            else {
                fillUnkownDates(geb);
                fullCounter++;
            }
        }
    }

    consola.info(`Häuserbuch ${path} geladen: ${partialCounter} teilweise und ${fullCounter} vollständige Einträge`)

    return result;
}

function fillUnkownDates(geb:Building) {
    let unknown:boolean;
    let changed:boolean;
    do {
        unknown = false;
        changed = false;
        for( let i=0; i < geb.yearInfos.length; i++ ) {
            const y = geb.yearInfos[i];
            if( y.year.isUnknown() ) {
                if( i > 0 && i < geb.yearInfos.length-1 ) {
                    y.year = zeit.zeitraum(geb.yearInfos[i-1].year, geb.yearInfos[i+1].year, y.year.getText());
                }
                else if( i == 0 ) {
                    y.year = zeit.zeitpunkt(geb.yearInfos[i+1].year, y.year.getText());
                }
                changed = changed || !y.year.isUnknown();
            }
            unknown = unknown || y.year.isUnknown();
        }
    } while(unknown && changed)

}

function readCell(sheet:XLSX.WorkSheet, row:string, col:number):string {
    const cell = sheet[row+col];
    if( cell ) {
        const val = cell.v;
        if( val ) {
            return val.toString();
        }
    }
    return '';
}

function determineInfoType(info:string):BuildingInfoType {
    const text = info.toLowerCase();
    if(text.includes('flur ') ) {
        return BuildingInfoType.Flur;
    }
    if(text.includes('größe') ) {
        return BuildingInfoType.Groesse;
    }
    if(text.includes('kat.-nr.') ) {
        return BuildingInfoType.Kataster;
    }
    if(text.includes('name: ')) {
        return BuildingInfoType.Name;
    }
    return BuildingInfoType.Unbekannt;
}