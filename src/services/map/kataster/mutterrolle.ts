import * as database from '#utils/database'
import * as gemeindeType from '#kataster/gemeindeType'

export class MutterrolleParzelle {
    constructor(
        public flurNr:number,
        public parzelle:string,
        public lage:string,
        public kulturart:string,
        public flaeche:string,
        public klasse:string,
        public reinertrag:string,
        public location:number[]) {}
}

export class Mutterrolle {
    public rows:MutterrolleParzelle[] = []

    constructor(public artikelNr:string, public name:string, public gemeinde:gemeindeType.GemeindeId) {}
}

export async function getAllEigentuemer():Promise<Mutterrolle[]> {
    const queryResult = await database.getClient().query({
        text: `SELECT i.mutterrolle as mutterrolle,i.eigentuemer as eigentuemer,i.gemeinde as gemeinde 
                FROM kataster_urkataster_info as i JOIN kataster_metadata_fluren as f on i.gemeinde=f.gemeinde and i.flur=f.id
                WHERE f.done=TRUE
                GROUP BY i.gemeinde,i.mutterrolle,i.eigentuemer 
                ORDER BY i.gemeinde,i.eigentuemer`
    })

    const result = [];
    for( const row of queryResult.rows) {
        result.push(new Mutterrolle(row.mutterrolle, row.eigentuemer, gemeindeType.forId(row.gemeinde)));
    }
    
    return result;
}

export async function getAllMutterrollen(gemeinde:gemeindeType.GemeindeId):Promise<Mutterrolle[]> {
    const queryResultLoc = await database.getClient().query({
        text: `SELECT gemeinde,flur,nr as parzelle,ST_X(ST_Transform(ST_CENTROID(ST_UNION(the_geom)),4326)) as x, ST_Y(ST_Transform(ST_CENTROID(ST_UNION(the_geom)),4326)) as y 
                FROM kataster_areas_1826 
                WHERE gemeinde=$1 GROUP BY gemeinde,flur,parzelle`, 
        values: [gemeinde.getId()]
    });

    const locMap = new Map<string,number[]>()
    for( const row of queryResultLoc.rows ) {
        locMap.set(row.gemeinde+"-"+row.flur+"-"+row.parzelle, [row.x, row.y]);
    }

    const queryResult = await database.getClient().query({
        text: `SELECT flur,nr as parzelle,flaeche,eigentuemer,typplain,lage,klasse,mutterrolle,reinertrag,gemeinde 
                FROM kataster_urkataster_info 
                WHERE gemeinde=$1 AND mutterrolle IS NOT NULL ORDER BY gemeinde,eigentuemer`,
        values: [gemeinde.getId()]
    })

    const result = new Map<string,Mutterrolle>();
    for( const row of queryResult.rows) {
        if( !gemeinde.getFlur(row.flur).isDone() ) {
            continue;
        }
        if( !result.has(row.mutterrolle) ) {
            result.set(row.mutterrolle, new Mutterrolle(row.mutterrolle, row.eigentuemer, gemeindeType.forId(row.gemeinde)))
        }
        result.get(row.mutterrolle).rows.push(
            new MutterrolleParzelle(row.flur, row.parzelle, row.lage, row.typplain, row.flaeche, row.klasse, row.reinertrag, locMap.get(row.gemeinde+"-"+row.flur+"-"+row.parzelle))
        );
    }
    
    return new Array(...result.values());
}