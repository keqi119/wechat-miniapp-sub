export const partyVerificationNoteHint='填写4～500字，首尾空格不计。';

/** Keep this specific party-verification form aligned with the archive API. */
export function validatePartyVerificationNote(value:unknown):string{
 const note=typeof value==='string'?value.trim():'';
 if(note.length<4||note.length>500)throw new Error('核对资料及说明须填写4～500字（首尾空格不计）。');
 return note;
}
