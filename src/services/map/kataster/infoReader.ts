import * as gemeindeType from '#kataster/gemeindeType'
import XLSX from 'xlsx'
import * as XslxUtils from '#utils/xslxUtils'
import * as haeuserbuchLoader from '#kataster/haeuserbuchReader'
import * as database from '#utils/database'
import * as mapGenerator from '#kataster/mapGenerator'
import { NumberRangeMatcher } from '#kataster/numberRangeMatcher'
import consola from 'consola'

const katasterPath = process.env.KATASTER_PATH

class InfoMatcher {
    constructor(
        public kreis:gemeindeType.Kreis,
        public buergermeisterei:gemeindeType.Buergermeisterei,
        public gemeinde:gemeindeType.GemeindeId,
        public flur:number,
        public parzellen:NumberRangeMatcher
    ) {}
}

export abstract class Info {
    constructor(
        public type:string,
        public matcher:InfoMatcher,
    ) {}

    public matches(kreis:gemeindeType.Kreis, buergermeisterei:gemeindeType.Buergermeisterei, gemeinde:gemeindeType.GemeindeId, flur:number, parzelle:string):boolean {
        if( kreis != null ) {
            if( this.matcher.kreis == null || this.matcher.kreis.getId() != kreis.getId() ) {
                return false;
            }
        }
        else if( this.matcher.kreis != null ) {
            return false;
        }

        if( buergermeisterei != null ) {
            if( this.matcher.buergermeisterei == null || this.matcher.buergermeisterei.getId() != buergermeisterei.getId() ) {
                return false;
            }
        }
        else if( this.matcher.buergermeisterei != null ) {
            return false;
        }

        if( gemeinde != null ) {
            if( this.matcher.gemeinde == null || this.matcher.gemeinde.getId() != gemeinde.getId() ) {
                return false;
            }
        }
        else if( this.matcher.gemeinde != null ) {
            return false;
        }

        if( this.matcher.flur != flur ) {
            return false;
        }

        if( parzelle != null ) {
            if( this.matcher.parzellen == null || !this.matcher.parzellen.matches(parzelle) ) {
                return false;
            }
        }
        else if( this.matcher.parzellen != null ) {
            return false;
        }

        return true;
    }
}

export class WikipediaInfo extends Info {
    constructor(type:string, matcher:InfoMatcher, public page:string) {
        super(type, matcher);
    }
}


export class CommonInfo extends Info {
    constructor(type:string, matcher:InfoMatcher, public info:string, public source:string, public url:string) {
        super(type, matcher);
    }
}

export class HaeuserbuchInfo extends Info {
    constructor(
        type:string, 
        matcher:InfoMatcher,
        public gemeinde:gemeindeType.GemeindeId,
        public id:string,
        public infos:haeuserbuchLoader.BuildingInfo[], 
        public ownerList:haeuserbuchLoader.BuildingYearInfo[], 
        public additionalInfos:haeuserbuchLoader.BuildingYearInfo[], 
        public address:string) {
        super(type, matcher);
    }
}

export async function readAll():Promise<Info[]> {
    const result = [];
    XslxUtils.loadExcelsInPath(`${katasterPath}/additional_infos`, (path,file) => {
        try {
            readInfoFromPath(result, path+"/"+file)
        }
        catch( ex ) {
            consola.error("Konnte Zusatzinformationen aus", path+"/"+file, "nicht (vollständig) lesen.", ex)
        }
    })

    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        try {
            result.push(...await readHaeuserbuch(gemeinde))
        }
        catch( ex ) {
            consola.error("Konnte Häuserbuch für Gemeinde", gemeinde.getId(), "nicht lesen.", ex)
        }
    }

    return result;
}

class BuildingHnr {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public parzelle:string, public hnr:string) {}
}

async function readDbBuildings(gemeinde:gemeindeType.GemeindeId):Promise<BuildingHnr[]> {
    const buildings = await database.getClient().query({
        text: `SELECT gemeinde as gemeinde,flur as flur,nr as parzelle,hnr as hnr FROM "kataster_gen_buildings" where hnr is not null and hnr!='' and gemeinde=$1`, 
        values: [gemeinde.getId()]
    })

    const result = [];
    for( const b of buildings.rows ) {
        result.push(new BuildingHnr(gemeindeType.forId(b.gemeinde), b.flur, b.parzelle, b.hnr))
    }
    return result;
}

async function readHaeuserbuch(gemeinde:gemeindeType.GemeindeId):Promise<Info[]> {
    const result:Info[] = []
    const hb = haeuserbuchLoader.loadHaeuserbuchByGemeinde(gemeinde)
    if( !hb || hb.streets.length == 0 ) {
        return result
    }

    const dbBuildings = await readDbBuildings(gemeinde);
    const hnrMap = new Map<string,[number,string]>();
    for( const b of dbBuildings ) {
        if( b.gemeinde.getId() != gemeinde.getId() ) {
            continue;
        }

        hnrMap.set(cleanupHnr(b.hnr), [b.flur, b.parzelle])
    }

    for( const hbStreet of hb.streets ) {
        for( const building of hbStreet.buildings ) {
            let infoMatcher = createMatcherByHaeuserbuchFlur(gemeinde, building);
            if( !infoMatcher ) {
                infoMatcher = createMatcherByHaeuserbuchHnr(gemeinde, building, hnrMap);
            }
            if( !infoMatcher ) {
                continue;
            }
           
            if( building.infos.length > 0 || building.ownerList.length > 0 || building.additionalInfos.length > 0 ) {
                result.push(new HaeuserbuchInfo(
                    'haeuserbuch', 
                    infoMatcher,
                    gemeinde,
                    building.id,
                    building.infos, 
                    building.ownerList, 
                    building.additionalInfos.length > 0 ? building.additionalInfos : null,
                    `Hausnummer ${building.oldNumber} (${building.street} ${building.number})`
                ))
            }
        }
    }
    return result
}

function createMatcherByHaeuserbuchHnr(gemeinde:gemeindeType.GemeindeId, building:haeuserbuchLoader.Building, hnrMap:Map<string,[number,string]>):InfoMatcher|null {
    let hnr = building.oldNumber?.toLowerCase();
    if( !hnr || hnr.startsWith('ohne') ) {
        return null;
    }

    hnr = hnr.replace('und', ',').replace('u.', ',');

    const hnrParts = hnr.split(',').map(p => p.trim());
    let matcher:InfoMatcher = null

    for( const part of hnrParts ) {
        if( part.startsWith('in ')) {
            continue;
        }

        const parzelle = hnrMap.get(cleanupHnr(part));
        if( !parzelle ) {
            continue;
        }

        if( matcher == null ) {
            matcher = new InfoMatcher(
                gemeinde.getParent().getKreis(),
                gemeinde.getParent(),
                gemeinde,
                parzelle[0],
                new NumberRangeMatcher(parzelle[1]));
        }
        else if( matcher.flur == parzelle[0] ) {
            matcher.parzellen.addPattern(parzelle[1])
        }
        else {
            // TODO: Weitere matches moeglich, tw. mehrere HNR im Haeuserbuch
            consola.warn("Konnte Hausnummer aus Flurbuch nicht im Matcher registrieren, mehrere Fluren:", part)
        }
    }
    return matcher
}

function cleanupHnr(hnr:string):string {
    return mapGenerator.optimizeHnr(hnr.toLowerCase().split(' ').join(''))
}

function createMatcherByHaeuserbuchFlur(gemeinde:gemeindeType.GemeindeId, building:haeuserbuchLoader.Building):InfoMatcher|null {
    const flur = building.flur?.text?.trim().toLowerCase();
    if( !flur || !flur.startsWith('flur ' ) ) {
        return null;
    }
    const flurParts = flur.split(' und ').join(',').split(' u. ').join(',').split(',')
    const regex = /flur ([0-9]+) nr. ([0-9]+[a-z/]?)/
    const matches = flurParts[0].trim().match(regex);
    if( !matches || matches.length < 2 || matches[2].endsWith("/") ) {
        return null;
    }
    if( building.infos.length == 0 && building.ownerList.length == 0 && building.additionalInfos.length == 0 ) {
        return null;
    }

    const numberMatcher = new NumberRangeMatcher(matches[2])
    for(let i=1; i < flurParts.length; i++) {
        const part = flurParts[i].trim()
        const nr = parseInt(part)
        if( `${nr}` === part ) {
            numberMatcher.addPattern(part)
        }
    }

    return new InfoMatcher(
        gemeinde.getParent().getKreis(),
        gemeinde.getParent(),
        gemeinde,
        parseInt(matches[1]),
        numberMatcher);
}

function readInfoFromPath(result:Info[], path:string) {
    const workbook = XLSX.readFile(path);

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const reader = new XslxUtils.TableLoader(sheet);

    let i = 1;
    let skipped = 0;
    while(true) {
        i++;
        const typ = reader.readString('Typ',i);
        const kreis = reader.readString('Kreis',i);
        const buergermeisterei = reader.readString('Bürgermeisterei',i);
        const gemeinde = reader.readString('Gemeinde',i);
        const flur = reader.readNumber('Flur',i);
        const parzellen = reader.readString('Parzellen',i);
        const info = reader.readString('Info',i);
        if( typ == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        
        const matcher = new InfoMatcher(
            kreis ? gemeindeType.kreisById(kreis) : null,
            buergermeisterei ? gemeindeType.buergermeistereiById(buergermeisterei) : null,
            gemeinde ? gemeindeType.forId(gemeinde) : null,
            flur ? flur : null,
            parzellen ? new NumberRangeMatcher(parzellen) : null);

        if( typ == 'wikipedia' ) {
            result.push(new WikipediaInfo(typ, matcher, info));
        }
        else if( typ == 'common' ) {
            result.push(new CommonInfo(typ, matcher, info, reader.readString('Quelle', i), reader.readString('URL', i)));
        }
        else {
            throw new Error('Unknown additional info typ: '+typ);
        }
    }

    return result;
}