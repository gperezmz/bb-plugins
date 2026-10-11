// The smallest byte strings the icon types are recognised by.

export const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
export const gif = () => Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1");
export const webp = () => Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ", "latin1");
export const ico = () => Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]);
export const svg = (body = "") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
export const avif = () => {
  const box = Buffer.alloc(16);
  box.writeUInt32BE(16, 0);
  box.write("ftypavif", 4, "latin1");
  return box;
};
