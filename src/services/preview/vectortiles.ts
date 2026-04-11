import * as express from 'express';
import * as database from '#utils/database'

class Tile {
    constructor(public x:number, public y:number, public zoom:number, public format:string) {}
}

function tileToEnvelope(tile:Tile):Map<string,number> {
    // Width of world in EPSG:3857
    let worldMercMax = 20037508.3427892
    let worldMercMin = -1 * worldMercMax
    let worldMercSize = worldMercMax - worldMercMin
    // Width in tiles
    let worldTileSize = Math.pow(2,tile.zoom)
    // Tile width in EPSG:3857
    let tileMercSize = worldMercSize / worldTileSize
    // Calculate geographic bounds from tile coordinates
    // XYZ tile coordinates are in "image space" so origin is
    // top-left, not bottom right
    const env = new Map<string,number>()
    env['xmin'] = worldMercMin + tileMercSize * tile.x
    env['xmax'] = worldMercMin + tileMercSize * (tile.x + 1)
    env['ymin'] = worldMercMax - tileMercSize * (tile.y + 1)
    env['ymax'] = worldMercMax - tileMercSize * tile.y
    return env
}

// Do we have all keys we need? 
// Do the tile x/y coordinates make sense at this zoom level?
function tileIsValid(tile:Tile):boolean {
    if( !tile || !tile.x || !tile.y || !tile.zoom) {
        return false
    }
    if(!['pbf', 'mvt'].includes(tile.format)) {
        return false
    }
    let size = Math.pow(2, tile.zoom)
    if(tile.x >= size || tile.y >= size) {
        return false
    }
    if(tile.x < 0 || tile.y < 0) {
        return false
    }
    return true
}

function envelopeToBoundsSQL(env:Map<string,number>):string {
    const DENSIFY_FACTOR = 4
    env['segSize'] = Math.max((env['xmax'] - env['xmin'])/DENSIFY_FACTOR,1)
    let sqlTmpl = "ST_Segmentize(ST_MakeEnvelope($1, $2, $3, $4, 3857),$5)"
    return sqlTmpl
}
     
function envelopeToSQL(env:Map<string,number>, zoom:number):string {
    const envSql = envelopeToBoundsSQL(env)
    let sqlTmpl = `
        WITH 
        bounds AS (
            SELECT ${envSql} AS geom, 
                    ${envSql}::box2d AS b2d
        ),
        katareas1826 AS (
            SELECT id,gemeinde,flur,nr as flurstueck,flaeche,eigentuemer,mutterrolle as artikel,typPlain,typ,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            FROM kataster_areas_1826, bounds
            WHERE ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katbuildings AS (
            SELECT gemeinde,flur,nr as flurstueck,bezeichnung,typ,hnr,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            FROM kataster_gen_buildings, bounds
            WHERE yearfrom<=1825 AND yeartill>=1825 AND ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katstrassen AS (
            SELECT gemeinde,name,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            FROM kataster_gen_strassen, bounds
            WHERE ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katbezeichnungen AS (
            SELECT gemeinde,flur,name,typ,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            from kataster_gen_bezeichnungen, bounds
            WHERE (typ IS NULL OR typ=0) AND ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katorte AS (
            SELECT gemeinde,flur,name,typ,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            from kataster_gen_bezeichnungen, bounds
            WHERE (typ=1) AND ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katadmin AS (
            SELECT id,type,name,ST_AsMVTGeom(ST_TRANSFORM(the_geom,3857), bounds.b2d) AS geom
            from kataster_gen_admin, bounds
            WHERE ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416))
        ),
        katareas1826merged_1 AS (
            SELECT gemeinde,flur,typ,ST_TRANSFORM(ST_UNION(the_geom),3857) AS geom 
            FROM kataster_areas_1826, bounds
            WHERE ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416)) 
            GROUP BY gemeinde,flur,typ
        ),
        katareas1826merged AS (
            SELECT gemeinde,flur,typ,ST_AsMVTGeom(katareas1826merged_1.geom, bounds.b2d) AS geom 
            FROM katareas1826merged_1, bounds
        ),
        
        tiles AS (
            (SELECT ST_AsMVT(katbuildings.*,'kataster_buildings_1826') as mvt FROM katbuildings)
            ${zoom < 15 ? 
                "UNION ALL (SELECT ST_AsMVT(katareas1826merged.*,'kataster_areas_merged_1826') as mvt FROM katareas1826merged)" : 
                "UNION ALL (SELECT ST_AsMVT(katareas1826.*,'kataster_areas_1826v2') as mvt FROM katareas1826)"}
            UNION ALL (SELECT ST_AsMVT(katstrassen.*,'kataster_strassen_1826') as mvt FROM katstrassen)
            UNION ALL (SELECT ST_AsMVT(katbezeichnungen.*,'kataster_bezeichnungen_1826v3') as mvt FROM katbezeichnungen)
            UNION ALL (SELECT ST_AsMVT(katorte.*,'kataster_orte_1826v1') as mvt FROM katorte)
            UNION ALL (SELECT ST_AsMVT(katadmin.*,'kataster_admin_1826v1') as mvt FROM katadmin)
        )

       SELECT string_agg(mvt, '') as mvt from tiles;
    `
    console.log(sqlTmpl)
    console.log(env)
    /*
    
            
             SELECT string_agg(mvt, '') from tiles;
    ,
        katareas1826merged_1 AS (
            SELECT gemeinde,flur,typ,ST_TRANSFORM(ST_UNION(the_geom),3857) AS geom 
            FROM kataster_areas_1826, bounds
            WHERE ST_Intersects(the_geom, ST_Transform(bounds.geom, 7416)) 
            GROUP BY b2d,gemeinde,flur,typ
        ),
        katareas1826merged AS (
            SELECT gemeinde,flur,typ,ST_AsMVTGeom(geom, bounds.b2d) AS geom 
            FROM katareas1826merged_1, bounds
        )
            */
    return sqlTmpl
}

async function sqlToPbf(sql:string, env:Map<string,Number>) {
    const result = await database.getClient().query({
            text: sql, 
            values: [env['xmin'], env['ymin'], env['xmax'], env['ymax'], env['segSize']]
        })

    return result.rows[0]['mvt']
}

const router = express.Router()
router.get('/:zoom/:x/:y.:format', async function(req, res, next) {
    let tile = new Tile(parseInt(req.params.x), parseInt(req.params.y), parseInt(req.params.zoom), req.params.format);

    if(!tileIsValid(tile)) {
        res.sendStatus(400)
        res.send("invalid tile: "+tile)
        return
    }

    let env = tileToEnvelope(tile)
    let sql = envelopeToSQL(env, tile.zoom)
    let pbf = await sqlToPbf(sql, env)

    res.writeHead(200, {
        'Access-Control-Allow-Origin': "*",
        "Content-type": "application/vnd.mapbox-vector-tile",
        'Content-Length': pbf.length
    });
    res.end(pbf)
});

export default router;