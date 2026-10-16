// The recorded demo call, in a public Google Drive folder (anyone with the
// link can watch, no sign-in): the same call filmed from each side. Played
// on the site itself through Drive's embeddable player, for visitors who
// can't start a call because they don't have the access code.
export const DEMO_VIDEOS = [
  { label: 'Hindi speaker’s side', driveId: '1fa-nf4Zh582CB7nRfOPpVKXpIl7YFE0u' }, // meet-translate-pov1(hindi).mp4
  { label: 'Telugu speaker’s side', driveId: '1a04W9DNYVBvtyw4YPgYd14Xz8HTo_hkF' }, // meet-translate-pov1(telugu).mp4
];

// Drive's "/preview" address is the bare player, made to be put in an iframe.
export function drivePlayerUrl(driveId: string) {
  return `https://drive.google.com/file/d/${driveId}/preview`;
}
