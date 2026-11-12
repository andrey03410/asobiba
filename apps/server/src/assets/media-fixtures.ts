/** Small structurally valid containers for storage/HTTP tests; not playback fixtures. */
export function wav(): Buffer {
  const body = Buffer.alloc(48);
  body.write("RIFF"); body.writeUInt32LE(40, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(8000, 24); body.writeUInt32LE(16000, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(4, 40);
  return body;
}

/** Real mono PCM, 8 kHz, 16 bit; silence keeps generated playback fixtures tiny. */
export function wavSeconds(seconds: number): Buffer {
  const dataBytes = Math.round(seconds * 16000);
  const body = Buffer.alloc(44 + dataBytes);
  wav().copy(body, 0, 0, 44);
  body.writeUInt32LE(body.length - 8, 4);
  body.writeUInt32LE(dataBytes, 40);
  return body;
}

export function mp3(): Buffer {
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0]);
  return Buffer.concat([frame, frame]);
}

export function ogg(): Buffer {
  const header = Buffer.alloc(28); header.write("OggS"); header[5] = 2; header[26] = 1; header[27] = 19;
  const packet = Buffer.alloc(19); packet.write("OpusHead"); packet[8] = 1; packet[9] = 1;
  return Buffer.concat([header, packet]);
}

function box(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length + 8); head.write(type, 4);
  return Buffer.concat([head, body]);
}

export function mp4(audio = false): Buffer {
  const hdlr = Buffer.alloc(24); hdlr.write(audio ? "soun" : "vide", 8);
  const stsd = Buffer.alloc(8); stsd.writeUInt32BE(1, 4);
  const track = box("trak", box("mdia", Buffer.concat([box("hdlr", hdlr), box("minf", box("stbl", box("stsd", Buffer.concat([stsd, box(audio ? "mp4a" : "avc1", Buffer.alloc(32))]))))])));
  return Buffer.concat([box("ftyp", Buffer.from(audio ? "M4A \0\0\0\0M4A isom" : "isom\0\0\0\0isommp42")), box("mdat", Buffer.from([1, 2])), box("moov", track)]);
}

export function webm(): Buffer {
  const ebml = Buffer.from("1a45dfa3874282847765626d", "hex");
  const entry = Buffer.concat([Buffer.from([0x83, 0x81, 1, 0x86, 0x85]), Buffer.from("V_VP9")]);
  const track = Buffer.concat([Buffer.from([0xae, 0x80 + entry.length]), entry]);
  const payload = Buffer.concat([Buffer.from("1654ae6b", "hex"), Buffer.from([0x80 + track.length]), track, Buffer.from("1f43b67580", "hex")]);
  return Buffer.concat([ebml, Buffer.from("18538067", "hex"), Buffer.from([0x80 + payload.length]), payload]);
}
