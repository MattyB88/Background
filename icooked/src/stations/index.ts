import type { App } from '../app';
import { STATIONS, type StationId } from '../render/factory';
import { AoiStation } from './aoi';
import type { Station } from './base';
import { DeskStation } from './desk';
import { FeederStation } from './feeders';
import { OfficeStation } from './office';
import { StoresStation } from './stores';
import { InspectStation } from './inspect';
import { OvenStation } from './oven';
import { PrinterStation } from './printer';
import { Px9Station } from './px9';
import { ReworkStation } from './rework';
import { TestStation } from './test';

const CTORS: Record<StationId, new (app: App, spot: (typeof STATIONS)[number]) => Station> = {
  desk: DeskStation,
  office: OfficeStation,
  stores: StoresStation,
  feeders: FeederStation,
  printer: PrinterStation,
  px9: Px9Station,
  inspect: InspectStation,
  oven: OvenStation,
  aoi: AoiStation,
  test: TestStation,
  rework: ReworkStation,
};

export function makeStations(app: App): Map<StationId, Station> {
  const m = new Map<StationId, Station>();
  for (const spot of STATIONS) {
    const s = new CTORS[spot.id](app, spot);
    s.build();
    m.set(spot.id, s);
  }
  return m;
}
