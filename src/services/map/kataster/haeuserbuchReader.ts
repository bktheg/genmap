import XLSX from 'xlsx'
import * as zeit from '#utils/zeit'
import * as XslxUtils from '#utils/xslxUtils'
import { GemeindeId, forId } from '#kataster/gemeindeType';
import { consola } from 'consola';

const katasterPath = process.env.KATASTER_PATH

export class Building {
    street:string
    number:string
    oldNumber:string
    infos: BuildingInfo[] = []
    flur:BuildingInfo
    ownerList: BuildingYearInfo[] = []
    additionalInfos: BuildingYearInfo[] = []
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
    const sheet = new XslxUtils.TableLoader(workbook.Sheets['Blatt1']);
    let i = 1;
    let skipped = 0;
    let building:Building = null;
    let anmerkung = false
    while(true) {
        i++;
        const streetName = sheet.readString('Straße', i)
        const hnrCell = sheet.readString('Nummer', i)
        const infotext = sheet.readString('Information', i)
        if( !streetName && !hnrCell && !infotext ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        skipped = 0;
        anmerkung = false

        if( streetName && (currentStreet == null || currentStreet.name != streetName)) {
            currentStreet = new Street();
            currentStreet.name = streetName;
            result.push(currentStreet);
        }
        
        if( streetName && hnrCell ) {
            building = new Building();
            building.street = streetName;
            building.number =  hnrCell;
            building.oldNumber = sheet.readString('Alte Nummer', i)
            currentStreet.buildings.push(building);
        }

        if( infotext && streetName && !hnrCell ) {
            const info:StreetInfo = {
                text: infotext
            };

            currentStreet.infos.push(info);
        }
        else if( infotext ) {
            let year = sheet.readString('Jahr', i)
            if( year.toLowerCase().startsWith('anm') ) {
                anmerkung = true
            }         

            if( anmerkung ) {
                let parsedYear:zeit.Zeit
                try {
                    const yearInt = parseInt(infotext.substr(0,5).trim());
                    if( yearInt > 1000 && yearInt < 2000 ) {
                        parsedYear = zeit.parse(`${yearInt}`)
                    }
                }
                catch(ex) {
                    // Ignore, no date
                }

                const info:BuildingYearInfo = {
                    year: parsedYear,
                    text: infotext
                };

                building.additionalInfos.push(info);
            }
            else if( !year ) {
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

                building.ownerList.push(info);
            }
        }
    }
    
    let fullCounter = 0;
    let partialCounter = 0;
    for( let street of result ) {
        for( let geb of street.buildings ) {
            if( geb.ownerList.length == 0 ) {
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
        for( let i=0; i < geb.ownerList.length; i++ ) {
            const y = geb.ownerList[i];
            if( y.year.isUnknown() ) {
                if( i > 0 && i < geb.ownerList.length-1 ) {
                    y.year = zeit.zeitraum(geb.ownerList[i-1].year, geb.ownerList[i+1].year, y.year.getText());
                }
                else if( i == 0 ) {
                    y.year = zeit.zeitpunkt(geb.ownerList[i+1].year, y.year.getText());
                }
                changed = changed || !y.year.isUnknown();
            }
            unknown = unknown || y.year.isUnknown();
        }
    } while(unknown && changed)

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