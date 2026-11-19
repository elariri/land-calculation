import { parseLatLng, photonLabel } from './search';

describe('photonLabel', () => {
  it('joins name and area without repeats', () => {
    expect(photonLabel({ name: 'Ouarzazate', county: "Pachalik d'Ouarzazate", state: 'Drâa-Tafilalet', country: 'Maroc' })).toBe(
      "Ouarzazate, Pachalik d'Ouarzazate, Drâa-Tafilalet, Maroc",
    );
    expect(photonLabel({ name: 'Casablanca', city: 'Casablanca', country: 'Maroc' })).toBe('Casablanca, Maroc');
  });

  it('falls back to street + number when there is no name', () => {
    expect(photonLabel({ street: 'Rue Allal Ben Abdellah', housenumber: '12', city: 'Rabat' })).toBe(
      'Rue Allal Ben Abdellah 12, Rabat',
    );
  });
});

describe('parseLatLng', () => {
  it('parses comma, semicolon and space separated pairs', () => {
    expect(parseLatLng('31.63, -8.008')).toEqual({ lat: 31.63, lng: -8.008 });
    expect(parseLatLng(' 33.5731;-7.5898 ')).toEqual({ lat: 33.5731, lng: -7.5898 });
    expect(parseLatLng('34 -6')).toEqual({ lat: 34, lng: -6 });
  });

  it('rejects place names and out-of-range values', () => {
    expect(parseLatLng('Marrakech')).toBeNull();
    expect(parseLatLng('route 12, Settat')).toBeNull();
    expect(parseLatLng('91, 0')).toBeNull();
    expect(parseLatLng('0, 181')).toBeNull();
    expect(parseLatLng('')).toBeNull();
  });
});
