import * as satellite from 'satellite.js';
import { PassEvent } from '../types';

const STARLINK_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle';

type TleSatellite = {
  name: string;
  tle1: string;
  tle2: string;
};

export async function getUpcomingStarlinkPasses(lat: number, lon: number, limit = 5): Promise<PassEvent[]> {
  const tles = await fetchStarlinkTles();
  const observerGd = {
    longitude: satellite.degreesToRadians(lon),
    latitude: satellite.degreesToRadians(lat),
    height: 0.0,
  };

  const now = new Date();
  const end = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const stepMs = 20 * 1000;

  const allPasses: PassEvent[] = [];

  for (const satData of tles.slice(0, 120)) {
    const satrec = satellite.twoline2satrec(satData.tle1, satData.tle2);
    let inPass = false;
    let passStart: Date | null = null;
    let passEnd: Date | null = null;
    let maxElevation = -90;
    let startAz = 0;
    let endAz = 0;

    for (let t = now.getTime(); t <= end.getTime(); t += stepMs) {
      const time = new Date(t);
      const positionAndVelocity = satellite.propagate(satrec, time);
      const eci = positionAndVelocity.position;
      if (!eci) continue;
      const gmst = satellite.gstime(time);
      const ecf = satellite.eciToEcf(eci, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, ecf);
      const elevationDeg = satellite.radiansToDegrees(lookAngles.elevation);
      const azimuthDeg = satellite.radiansToDegrees(lookAngles.azimuth);

      if (elevationDeg > 10) {
        if (!inPass) {
          inPass = true;
          passStart = time;
          startAz = azimuthDeg;
          maxElevation = elevationDeg;
        } else {
          maxElevation = Math.max(maxElevation, elevationDeg);
        }
        passEnd = time;
        endAz = azimuthDeg;
      } else if (inPass) {
        allPasses.push(buildPassEvent(satData.name, passStart!, passEnd!, startAz, endAz, maxElevation));
        inPass = false;
        passStart = null;
        passEnd = null;
        maxElevation = -90;
      }
    }

    if (inPass && passStart && passEnd) {
      allPasses.push(buildPassEvent(satData.name, passStart, passEnd, startAz, endAz, maxElevation));
    }
  }

  allPasses.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

  const deduped = dedupeClosePasses(allPasses);
  return deduped.slice(0, limit);
}

async function fetchStarlinkTles(): Promise<TleSatellite[]> {
  const response = await fetch(STARLINK_TLE_URL);
  if (!response.ok) throw new Error('Failed to fetch TLE');
  const text = await response.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const satellites: TleSatellite[] = [];
  for (let i = 0; i < lines.length; i += 3) {
    if (lines[i + 2]) {
      satellites.push({ name: lines[i], tle1: lines[i + 1], tle2: lines[i + 2] });
    }
  }
  return satellites;
}

function buildPassEvent(name: string, start: Date, end: Date, startAz: number, endAz: number, maxElevationDeg: number): PassEvent {
  return {
    id: `${name}-${start.toISOString()}`,
    satelliteName: name,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startLocal: formatLocalTime(start),
    endLocal: formatLocalTime(end),
    directionText: `${azToText(startAz)} → ${azToText(endAz)}`,
    maxElevationDeg,
    brightnessHint: maxElevationDeg > 55 ? '높음' : maxElevationDeg > 30 ? '보통' : '낮음',
    risk: maxElevationDeg > 55 ? '높음' : maxElevationDeg > 30 ? '보통' : '낮음',
  };
}

function azToText(az: number): string {
  const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const normalized = ((az % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date);
}

function dedupeClosePasses(events: PassEvent[]): PassEvent[] {
  const kept: PassEvent[] = [];
  for (const event of events) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(event);
      continue;
    }
    const deltaMinutes = Math.abs(new Date(event.startIso).getTime() - new Date(last.startIso).getTime()) / 60000;
    if (deltaMinutes < 2 && event.directionText === last.directionText) {
      if (event.maxElevationDeg > last.maxElevationDeg) kept[kept.length - 1] = event;
    } else {
      kept.push(event);
    }
  }
  return kept;
}
