import XLSX from 'xlsx'
import * as zeit from '#utils/zeit'
import * as XslxUtils from '#utils/xslxUtils'
import { GemeindeId, forId } from '#kataster/gemeindeType';
import { consola } from 'consola';

const katasterPath = process.env.KATASTER_PATH

export class Building {
    id:string
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

export class Info {
    constructor(public text:string, public sources:string[]) {}
}

export class BuildingInfo extends Info {
    constructor(public type:BuildingInfoType, text:string, sources:string[]) {
        super(text, sources)
    }
}

export class BuildingYearInfo extends Info {
    constructor(public year:zeit.Zeit, public text:string, public sources:string[]) {
        super(text, sources)
    }
}

export class Street {
    name:string
    buildings:Building[] = []
    infos:BuildingYearInfo[] = []
}


export class Source {
    constructor(public id:string, public signatureOld:string, public signatureNew:string, public archive:string, public name:string) {}
}

export class Haeuserbuch {
    public streets:Street[] = []
    public sources:Map<string,Source> = new Map()
    public emptySources:Set<string> = new Set()

    constructor() {}
}

let LOADED = null as null|Map<GemeindeId,Haeuserbuch>

export function loadHaeuserbuchByGemeinde(gemeinde:GemeindeId): Haeuserbuch {
    if( !LOADED ) {
        LOADED = loadAll();
    }
    return LOADED.get(gemeinde)
}

function loadAll():Map<GemeindeId,Haeuserbuch> {
    const result = new Map<GemeindeId,Haeuserbuch>()

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

function load(path:string):Haeuserbuch {
    const workbook = XLSX.readFile(path);
   
    let result = new Haeuserbuch()
    const sheet = new XslxUtils.TableLoader(workbook.Sheets['Blatt1'])
    loadStreets(result, sheet)

    const sourcesSheet = new XslxUtils.TableLoader(workbook.Sheets['Quellen']);
    loadSources(result, sourcesSheet)
    
    let fullCounter = 0;
    let partialCounter = 0;
    for( let street of result.streets ) {
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

function loadSources(result:Haeuserbuch, sheet:XslxUtils.TableLoader):void {
    let i = 1
    let skipped = 0
    while(true) {
        i++
        const id = sheet.readString('id', i)
        if( !id ) {
            if( skipped++ > 5 ) {
                break
            }
            continue
        }

        const signatureOld = sheet.readString('Signatur alt', i)
        const name = sheet.readString('Name', i)
        if( !name && !signatureOld ) {
            result.emptySources.add(id)
            continue
        }

        result.sources.set(id, new Source(
            id,
            signatureOld,
            sheet.readString('Signatur neu', i),
            sheet.readString('Archiv', i),
            name
        ))
    }
}

function loadStreets(result:Haeuserbuch, sheet:XslxUtils.TableLoader):void {
    let currentStreet:Street = null;
    
    const idSet = new Set<string>()
    let i = 1;
    let skipped = 0;
    let building:Building = null;
    let anmerkung = false
    while(true) {
        i++;
        const streetName = sheet.readString('Straße', i)
        const hnrCell = sheet.readString('Nummer', i)
        const infotext = sheet.readString('Information', i)
        const quellen = sheet.readString('Quellen', i)
        if( !streetName && !hnrCell && !infotext ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        skipped = 0;
        
        if( streetName && (currentStreet == null || currentStreet.name != streetName)) {
            currentStreet = new Street();
            currentStreet.name = streetName;
            result.streets.push(currentStreet);
            building = null
        }
        
        if( streetName && hnrCell ) {
            building = new Building();
            building.street = streetName;
            building.number =  hnrCell;
            building.oldNumber = sheet.readString('Alte Nummer', i)
            let id = `${building.street}_${building.number}_${building.oldNumber.includes(',') ? building.oldNumber.split(',')[0] : building.oldNumber}`
            if( idSet.has(id) ) {
              id = id + `_${currentStreet.buildings.length + 1}`;  
            }
            building.id = id
            idSet.add(id)
            currentStreet.buildings.push(building);
            
            anmerkung = false
        }

        let quellenParts = quellen ? quellen.split(',').map(q => q.trim()) : []
        let year = sheet.readString('Jahr', i)
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

        if( infotext && !building ) {
            currentStreet.infos.push(new BuildingYearInfo(parsedYear, infotext, quellenParts));
        }
        else if( infotext ) {
            if( year.toLowerCase().startsWith('anm') ) {
                anmerkung = true
            }

            if( anmerkung ) {
                const info = new BuildingYearInfo(parsedYear, infotext, quellenParts)

                building.additionalInfos.push(info);
            }
            else if( !year ) {
                const info = new BuildingInfo(determineInfoType(infotext), infotext, quellenParts);

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

                const info = new BuildingYearInfo(parsedYear, infotext, quellenParts)
                
                building.ownerList.push(info);
            }
        }
    }
}

function fillUnkownDates(geb:Building) {
    let unknown:boolean;
    let changed:boolean;
    do {
        unknown = false;
        changed = false;
        for( let i=0; i < geb.ownerList.length-1; i++ ) {
            const y = geb.ownerList[i];
            if( y.year.isUnknown() ) {
                if( i > 0 ) {
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