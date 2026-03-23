export type Mode = 'avoid' | 'capture';

export type PassEvent = {
  id: string;
  satelliteName: string;
  startIso: string;
  endIso: string;
  startLocal: string;
  endLocal: string;
  directionText: string;
  maxElevationDeg: number;
  brightnessHint: string;
  risk: '낮음' | '보통' | '높음';
};

export type AnalysisResponse = {
  label: 'Starlink' | 'Meteor' | 'Airplane' | 'Unknown';
  confidence: number;
  linesDetected: number;
  reason: string;
  nearestPassHint?: string | null;
};
