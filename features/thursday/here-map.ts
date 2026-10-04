import { HERE } from "@/config";

// The globe's map (components/here-globe): Natural Earth's countries as scripts/here-map.mts
// packs them into public/here/world.json, which country a place is in, and the view that
// fits that country in a frame. No DOM, so it is tested in node; the rasters the globe is
// sampled from are drawn in the component.

/** `[west, east, south, north]`, degrees. */
export type Box = [number, number, number, number];

/**
 * A ring is `[lon, lat, lon, lat, …]`, its longitudes unwrapped so it never jumps at 180°; the
 * first is the outline, the rest are holes.
 */
type Polygon = { rings: Float32Array[]; bbox: Box };

export type Country = {
  name: string;
  /** ISO 3166 two letters, as the place service names it; null where it has none (Kosovo). */
  code: string | null;
  polys: Polygon[];
  bbox: Box;
};

export type World = { countries: Country[] };

/** The file as scripts/here-map.mts writes it. */
type Packed = {
  v: 2;
  q: number;
  a: number[][];
  c: { n: string; k?: string; p: number[][][] }[];
};

const RAD = Math.PI / 180;

/** A longitude difference folded into -180..180. */
export const wrap = (degrees: number) =>
  ((((degrees + 180) % 360) + 360) % 360) - 180;

const areaOf = (ring: Float32Array) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
    sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return Math.abs(sum / 2);
};

export function decodeWorld(json: unknown): World {
  const packed = json as Packed;
  if (packed?.v !== 2 || !Array.isArray(packed.a) || !Array.isArray(packed.c))
    throw new Error("world.json is not a map this app packs");
  const q = packed.q;
  const arcs = packed.a.map((steps) => {
    const out = new Float32Array(steps.length);
    let x = 0;
    let y = 0;
    for (let i = 0; i < steps.length; i += 2) {
      x += steps[i];
      y += steps[i + 1];
      out[i] = x / q - 180;
      out[i + 1] = y / q - 90;
    }
    return out;
  });
  // A ring that crosses 180° (Russia, Fiji) runs on past it without a jump; whatever draws it
  // draws it again 360° to either side. One that runs all the way round (Antarctica's coast)
  // goes round a pole, and on a flat map it is closed along that pole: the file draws it for a
  // sphere, with a ring of its own lying on the pole, which has no area here and is left out
  const ring = (indices: number[]) => {
    const out: number[] = [];
    let previous: number | null = null;
    for (const index of indices) {
      const arc = arcs[index >= 0 ? index : ~index];
      const n = arc.length / 2;
      for (let k = out.length ? 1 : 0; k < n; k++) {
        const m = index >= 0 ? k : n - 1 - k;
        let x = arc[2 * m];
        if (previous !== null) {
          while (x - previous > 180) x -= 360;
          while (x - previous < -180) x += 360;
        }
        out.push(x, arc[2 * m + 1]);
        previous = x;
      }
    }
    const round =
      out.length >= 4 && Math.abs(out[out.length - 2] - out[0]) > 359;
    if (round) {
      let lat = 0;
      for (let i = 1; i < out.length; i += 2) lat += out[i];
      const pole = lat < 0 ? -90 : 90;
      out.push(out[out.length - 2], pole, out[0], pole);
    }
    return new Float32Array(out);
  };
  const empty = (): Box => [180, -180, 90, -90];
  const grow = (box: Box, points: Float32Array) => {
    for (let i = 0; i < points.length; i += 2) {
      box[0] = Math.min(box[0], points[i]);
      box[1] = Math.max(box[1], points[i]);
      box[2] = Math.min(box[2], points[i + 1]);
      box[3] = Math.max(box[3], points[i + 1]);
    }
  };
  const countries = packed.c.map(({ n, k, p }) => {
    const bbox = empty();
    const polys = p
      .map((indices) => indices.map(ring).filter((r) => areaOf(r) > 0))
      .filter((rings) => rings.length > 0)
      .map((rings) => {
        const box = empty();
        grow(box, rings[0]);
        grow(bbox, rings[0]);
        return { rings, bbox: box };
      });
    return { name: n, code: k ?? null, polys, bbox };
  });
  return { countries };
}

let load: Promise<World> | null = null;

/**
 * The map, fetched from the app's own public folder the first time a globe is wanted, and
 * kept until the globe is over (`releaseWorld`). A failure goes to whoever waits and is not
 * kept, so the next call asks again. Browser only: the path is the page's.
 */
export function loadWorld(): Promise<World> {
  load ??= fetch("/here/world.json")
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`/here/world.json answered ${response.status}`);
      return decodeWorld(await response.json());
    })
    .catch((cause) => {
      load = null;
      throw cause;
    });
  return load;
}

/** The globe is over: the map goes until tomorrow's, rather than staying for the page's life. */
export function releaseWorld() {
  load = null;
}

/** Whether `(x, y)` is inside a ring, by crossings. */
function inRing(x: number, y: number, ring: Float32Array): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** The polygon of `country` that `(lat, lon)` is in, holes kept out; -1 when none is. */
function polygonAt(country: Country, lat: number, lon: number): number {
  for (const x of [lon, lon + 360, lon - 360]) {
    const [west, east, south, north] = country.bbox;
    if (x < west || x > east || lat < south || lat > north) continue;
    for (let p = 0; p < country.polys.length; p++) {
      const { rings, bbox } = country.polys[p];
      if (x < bbox[0] || x > bbox[1] || lat < bbox[2] || lat > bbox[3])
        continue;
      if (!inRing(x, lat, rings[0])) continue;
      if (!rings.slice(1).some((hole) => inRing(x, lat, hole))) return p;
    }
  }
  return -1;
}

/** The polygon of `country` nearest `(lat, lon)`, by its box: where a town on its coast is. */
function nearestPolygon(country: Country, lat: number, lon: number): number {
  let best = 0;
  let least = Number.POSITIVE_INFINITY;
  country.polys.forEach(({ bbox }, p) => {
    const dx = Math.max(
      0,
      Math.abs(wrap(lon - (bbox[0] + bbox[1]) / 2)) - (bbox[1] - bbox[0]) / 2,
    );
    const dy = Math.max(0, bbox[2] - lat, lat - bbox[3]);
    const d = Math.hypot(dx * Math.cos(lat * RAD), dy);
    if (d < least) {
      least = d;
      best = p;
    }
  });
  return best;
}

/**
 * The country a place is in, and the polygon of it they are on; null out at sea. The place
 * service's own answer (`code`, what her prompt names) decides it where the map has that code:
 * on outlines this simple, a town on a border or a strait falls in its neighbour. Otherwise the
 * outlines do, and a position just off a coast counts within HERE `coastDeg`, nearest first.
 */
export function homeOf(
  world: World,
  lat: number,
  lon: number,
  code?: string | null,
): { country: number; poly: number } | null {
  const named = code
    ? world.countries.findIndex((country) => country.code === code)
    : -1;
  if (named >= 0 && world.countries[named].polys.length) {
    const country = world.countries[named];
    const poly = polygonAt(country, lat, lon);
    return {
      country: named,
      poly: poly >= 0 ? poly : nearestPolygon(country, lat, lon),
    };
  }
  const at = (la: number, lo: number) => {
    for (let k = 0; k < world.countries.length; k++) {
      const poly = polygonAt(world.countries[k], la, lo);
      if (poly >= 0) return { country: k, poly };
    }
    return null;
  };
  let found = at(lat, lon);
  const steps = Math.round(HERE.coastDeg * 10);
  for (let step = 1; !found && step <= steps; step++) {
    const reach = step / 10;
    for (let k = 0; k < 8 && !found; k++)
      found = at(
        lat + reach * Math.sin((k * Math.PI) / 4),
        lon + reach * Math.cos((k * Math.PI) / 4),
      );
  }
  return found;
}

/** Where the globe lands: its centre, its radius and the country it is on. */
export type View = {
  lat: number;
  lon: number;
  /** The centre of the view, degrees. */
  latc: number;
  lonc: number;
  /** The globe's radius there, in the face's reference units (ascii-orb DESIGN). */
  radius: number;
  /** Their country, an index into `countries`; -1 out at sea. */
  home: number;
};

/** The frame, in reference units, and how much of it their country may take. */
type Frame = {
  width: number;
  height: number;
  /** The smallest the globe is ever drawn at the end of its dive: a little past her own size. */
  least: number;
};

/**
 * How a country fits the frame: `high` and `wide` are the shares of the frame's height and
 * width it may take either side of its centre, and `low` how far below the frame's middle
 * that centre sits. Drawing, not tuning: past these it reaches the words under her face.
 */
const FIT = { high: 0.32, wide: 0.44, low: 0.08 };

/**
 * The view that fits their country in the frame, low in it, with the sky left above for the
 * sun, the moon and the weather. The part of the country they are on is what fits, with every
 * part of it close by (Jeju, Kyushu); a small island of it close to its mainland (Long Island,
 * Jeju) fits the mainland instead. Out at sea, a fixed stretch around them.
 */
export function fitView(
  world: World,
  lat: number,
  lon: number,
  frame: Frame,
  /** The country the place service named (homeOf). */
  code?: string | null,
): View {
  const found = homeOf(world, lat, lon, code);
  const { width, height } = frame;
  let latc = lat;
  let lonc = lon;
  let radius: number;
  if (found) {
    const polys = world.countries[found.country].polys;
    const area = (ring: Float32Array) => {
      let sum = 0;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
        sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
      return Math.abs(sum / 2) * Math.cos(ring[1] * RAD);
    };
    let main = found.poly;
    let largest = 0;
    polys.forEach((poly, i) => {
      const size = area(poly.rings[0]);
      if (size > largest) {
        largest = size;
        main = i;
      }
    });
    let from = found.poly;
    if (
      main !== found.poly &&
      area(polys[found.poly].rings[0]) < largest * 0.25
    ) {
      const box = polys[main].bbox;
      const gap = Math.hypot(
        Math.max(0, box[0] - lon, lon - box[1]) * Math.cos(lat * RAD),
        Math.max(0, box[2] - lat, lat - box[3]),
      );
      if (gap < 4) from = main;
    }
    // that part and every part of the country within 2.5° of it, as one box
    const group: Box = [...polys[from].bbox];
    const used = [from];
    for (let pass = 0; pass < 3; pass++)
      polys.forEach((poly, i) => {
        const box = poly.bbox;
        if (
          used.includes(i) ||
          Math.max(0, box[0] - group[1], group[0] - box[1]) >= 2.5 ||
          Math.max(0, box[2] - group[3], group[2] - box[3]) >= 2.5
        )
          return;
        used.push(i);
        group[0] = Math.min(group[0], box[0]);
        group[1] = Math.max(group[1], box[1]);
        group[2] = Math.min(group[2], box[2]);
        group[3] = Math.max(group[3], box[3]);
      });
    latc = (group[2] + group[3]) / 2;
    lonc = wrap((group[0] + group[1]) / 2);
    const shrink = Math.cos(latc * RAD);
    // they are always in the picture, never at its edge
    let halfHigh = Math.abs(lat - latc);
    let halfWide = Math.abs(wrap(lon - lonc)) * shrink;
    for (const i of used) {
      const ring = polys[i].rings[0];
      for (let k = 0; k < ring.length; k += 2) {
        halfWide = Math.max(halfWide, Math.abs(wrap(ring[k] - lonc)) * shrink);
        halfHigh = Math.max(halfHigh, Math.abs(ring[k + 1] - latc));
      }
    }
    const tall = Math.min(70, Math.max(1, halfHigh * 1.15));
    const wide = Math.min(80, Math.max(1, halfWide * 1.15));
    radius = Math.min(
      (height * FIT.high) / Math.sin(tall * RAD),
      (width * FIT.wide) / Math.sin(wide * RAD),
    );
  } else radius = height / 2 / Math.sin(8 * RAD);
  radius = Math.max(
    frame.least,
    Math.min((height * FIT.high) / Math.sin(RAD), radius),
  );
  // the country sits low in the frame: the centre of the view is above it
  if (found) latc = Math.min(89, latc + (height * FIT.low) / radius / RAD);
  return { lat, lon, latc, lonc, radius, home: found ? found.country : -1 };
}

/**
 * A point on a globe of `radius` centred on `(latc, lonc)`: its place from the centre, in the
 * same units as the radius (y down), and whether it is on the side facing you.
 */
export function project(
  lat: number,
  lon: number,
  latc: number,
  lonc: number,
  radius: number,
): { x: number; y: number; seen: boolean } {
  const a = lat * RAD;
  const a0 = latc * RAD;
  const dl = (lon - lonc) * RAD;
  return {
    x: radius * Math.cos(a) * Math.sin(dl),
    y:
      -radius *
      (Math.cos(a0) * Math.sin(a) - Math.sin(a0) * Math.cos(a) * Math.cos(dl)),
    seen:
      Math.sin(a0) * Math.sin(a) + Math.cos(a0) * Math.cos(a) * Math.cos(dl) >
      0,
  };
}
