// AWS regions the VidAI fleet runs in, with map coordinates for the fleet globe.

export interface RegionInfo { code: string; city: string; lat: number; lon: number }

export const REGIONS: Record<string, RegionInfo> = {
  'ap-south-1': { code: 'ap-south-1', city: 'Mumbai', lat: 19.1, lon: 72.9 },
  'us-west-1': { code: 'us-west-1', city: 'N. California', lat: 37.4, lon: -122.0 },
  'eu-central-1': { code: 'eu-central-1', city: 'Frankfurt', lat: 50.1, lon: 8.7 },
  'eu-west-2': { code: 'eu-west-2', city: 'London', lat: 51.5, lon: -0.1 },
  'us-east-1': { code: 'us-east-1', city: 'N. Virginia', lat: 38.9, lon: -77.4 },
};

// Region of an environment from its name and (optionally) its probe host.
export function regionOf(envName: string, host?: string): string {
  const l = `${envName} ${host || ''}`.toLowerCase();
  if (/euc|eu-central-1|egypt/.test(l)) return 'eu-central-1';
  if (/usw|us-west-1|citmer/.test(l)) return 'us-west-1';
  if (/euw2|eu-west-2|london/.test(l)) return 'eu-west-2';
  if (/use1|us-east-1/.test(l)) return 'us-east-1';
  return 'ap-south-1';
}
