(function (root) {


const COORD_INTEGER_BITS = 14;
const COORD_FRACTIONAL_BITS = 5;
const COORD_DENOMINATOR = 1 << COORD_FRACTIONAL_BITS;
const COORD_RESOLUTION = 1.0 / COORD_DENOMINATOR;

// Special threshold for networking multiplayer origins
const COORD_INTEGER_BITS_MP = 11;
const COORD_FRACTIONAL_BITS_MP_LOWPRECISION = 3;
const COORD_DENOMINATOR_LOWPRECISION = 1 << COORD_FRACTIONAL_BITS_MP_LOWPRECISION;
const COORD_RESOLUTION_LOWPRECISION = 1.0 / COORD_DENOMINATOR_LOWPRECISION;

const NORMAL_FRACTIONAL_BITS = 11;
const NORMAL_DENOMINATOR = (1 << NORMAL_FRACTIONAL_BITS) - 1;
const NORMAL_RESOLUTION = 1.0 / NORMAL_DENOMINATOR;

const MAX_VAR_INT32_BYTES = 5;
const MASKS = [
	0,
	0xFFFFFFFF >> 31,
	0xFFFFFFFF >> 30,
	0xFFFFFFFF >> 29,
	0xFFFFFFFF >> 28,
	0xFFFFFFFF >> 27,
	0xFFFFFFFF >> 26,
	0xFFFFFFFF >> 25,
	0xFFFFFFFF >> 24,
	0xFFFFFFFF >> 23,
	0xFFFFFFFF >> 22,
	0xFFFFFFFF >> 21,
	0xFFFFFFFF >> 20,
	0xFFFFFFFF >> 19,
	0xFFFFFFFF >> 18,
	0xFFFFFFFF >> 17,
	0xFFFFFFFF >> 16,
	0xFFFFFFFF >> 15,
	0xFFFFFFFF >> 14,
	0xFFFFFFFF >> 13,
	0xFFFFFFFF >> 12,
	0xFFFFFFFF >> 11,
	0xFFFFFFFF >> 10,
	0xFFFFFFFF >> 9,
	0xFFFFFFFF >> 8,
	0xFFFFFFFF >> 7,
	0xFFFFFFFF >> 6,
	0xFFFFFFFF >> 5,
	0xFFFFFFFF >> 4,
	0xFFFFFFFF >> 3,
	0xFFFFFFFF >> 2,
	0xFFFFFFFF >> 1,
	0xFFFFFFFF,
];
/**********************************************************
 *
 * BitView
 *
 * BitView provides a similar interface to the standard
 * DataView, but with support for bit-level reads / writes.
 *
 **********************************************************/
var BitView = function (source, byteOffset, byteLength) {
	var isBuffer = source instanceof ArrayBuffer ||
		(typeof Buffer !== 'undefined' && source instanceof Buffer);

	if (!isBuffer) {
		throw new Error('Must specify a valid ArrayBuffer or Buffer.');
	}

	byteOffset = byteOffset || 0;
	byteLength = byteLength || source.byteLength /* ArrayBuffer */ || source.length /* Buffer */;

	this._view = new Uint8Array(source.buffer || source, byteOffset, byteLength);

	this.bigEndian = false;
};

// Used to massage fp values so we can operate on them
// at the bit level.
BitView._scratch = new DataView(new ArrayBuffer(8));

Object.defineProperty(BitView.prototype, 'buffer', {
	get: function () { return typeof Buffer !== 'undefined' ?  Buffer.from(this._view.buffer) : this._view.buffer; },
	enumerable: true,
	configurable: false
});

Object.defineProperty(BitView.prototype, 'byteLength', {
	get: function () { return this._view.length; },
	enumerable: true,
	configurable: false
});

BitView.prototype._setBit = function (offset, on) {
	if (on) {
		this._view[offset >> 3] |= 1 << (offset & 7);
	} else {
		this._view[offset >> 3] &= ~(1 << (offset & 7));
	}
};

BitView.prototype.getBits = function (offset, bits, signed) {
	var available = (this._view.length * 8 - offset);

	if (bits > available) {
		throw new Error('Cannot get ' + bits + ' bit(s) from offset ' + offset + ', ' + available + ' available');
	}

	var value = 0;
	for (var i = 0; i < bits;) {
		var remaining = bits - i;
		var bitOffset = offset & 7;
		var currentByte = this._view[offset >> 3];

		// the max number of bits we can read from the current byte
		var read = Math.min(remaining, 8 - bitOffset);

		var mask, readBits;
		if (this.bigEndian) {
			// create a mask with the correct bit width
			mask = ~(0xFF << read);
			// shift the bits we want to the start of the byte and mask of the rest
			readBits = (currentByte >> (8 - read - bitOffset)) & mask;

			value <<= read;
			value |= readBits;
		} else {
			// create a mask with the correct bit width
			mask = ~(0xFF << read);
			// shift the bits we want to the start of the byte and mask off the rest
			readBits = (currentByte >> bitOffset) & mask;

			value |= readBits << i;
		}

		offset += read;
		i += read;
	}

	if (signed) {
		// If we're not working with a full 32 bits, check the
		// imaginary MSB for this bit count and convert to a
		// valid 32-bit signed value if set.
		if (bits !== 32 && value & (1 << (bits - 1))) {
			value |= -1 ^ ((1 << bits) - 1);
		}

		return value;
	}

	return value >>> 0;
};

BitView.prototype.setBits = function (offset, value, bits) {
	var available = (this._view.length * 8 - offset);

	if (bits > available) {
		throw new Error('Cannot set ' + bits + ' bit(s) from offset ' + offset + ', ' + available + ' available');
	}

	for (var i = 0; i < bits;) {
		var remaining = bits - i;
		var bitOffset = offset & 7;
		var byteOffset = offset >> 3;
		var wrote = Math.min(remaining, 8 - bitOffset);

		var mask, writeBits, destMask;
		if (this.bigEndian) {
			// create a mask with the correct bit width
			mask = ~(~0 << wrote);
			// shift the bits we want to the start of the byte and mask of the rest
			writeBits = (value >> (bits - i - wrote)) & mask;

			var destShift = 8 - bitOffset - wrote;
			// destination mask to zero all the bits we're changing first
			destMask = ~(mask << destShift);

			this._view[byteOffset] =
				(this._view[byteOffset] & destMask)
				| (writeBits << destShift);

		} else {
			// create a mask with the correct bit width
			mask = ~(0xFF << wrote);
			// shift the bits we want to the start of the byte and mask of the rest
			writeBits = value & mask;
			value >>= wrote;

			// destination mask to zero all the bits we're changing first
			destMask = ~(mask << bitOffset);

			this._view[byteOffset] =
				(this._view[byteOffset] & destMask)
				| (writeBits << bitOffset);
		}

		offset += wrote;
		i += wrote;
	}
};

BitView.prototype.getBoolean = function (offset) {
	return this.getBits(offset, 1, false) !== 0;
};
BitView.prototype.getInt8 = function (offset) {
	return this.getBits(offset, 8, true);
};
BitView.prototype.getUint8 = function (offset) {
	return this.getBits(offset, 8, false);
};
BitView.prototype.getInt16 = function (offset) {
	return this.getBits(offset, 16, true);
};
BitView.prototype.getUint16 = function (offset) {
	return this.getBits(offset, 16, false);
};
BitView.prototype.getInt32 = function (offset) {
	return this.getBits(offset, 32, true);
};
BitView.prototype.getUint32 = function (offset) {
	return this.getBits(offset, 32, false);
};
BitView.prototype.getFloat32 = function (offset) {
	BitView._scratch.setUint32(0, this.getUint32(offset));
	return BitView._scratch.getFloat32(0);
};
BitView.prototype.getFloat64 = function (offset) {
	BitView._scratch.setUint32(0, this.getUint32(offset));
	// DataView offset is in bytes.
	BitView._scratch.setUint32(4, this.getUint32(offset+32));
	return BitView._scratch.getFloat64(0);
};

BitView.prototype.setBoolean = function (offset, value) {
	this.setBits(offset, value ? 1 : 0, 1);
};
BitView.prototype.setInt8  =
BitView.prototype.setUint8 = function (offset, value) {
	this.setBits(offset, value, 8);
};
BitView.prototype.setInt16  =
BitView.prototype.setUint16 = function (offset, value) {
	this.setBits(offset, value, 16);
};
BitView.prototype.setInt32  =
BitView.prototype.setUint32 = function (offset, value) {
	this.setBits(offset, value, 32);
};
BitView.prototype.setFloat32 = function (offset, value) {
	BitView._scratch.setFloat32(0, value);
	this.setBits(offset, BitView._scratch.getUint32(0), 32);
};
BitView.prototype.setFloat64 = function (offset, value) {
	BitView._scratch.setFloat64(0, value);
	this.setBits(offset, BitView._scratch.getUint32(0), 32);
	this.setBits(offset+32, BitView._scratch.getUint32(4), 32);
};
BitView.prototype.getArrayBuffer = function (offset, byteLength) {
	var buffer = new Uint8Array(byteLength);
	for (var i = 0; i < byteLength; i++) {
		buffer[i] = this.getUint8(offset + (i * 8));
	}
	return buffer;
};

/**********************************************************
 *
 * BitStream
 *
 * Small wrapper for a BitView to maintain your position,
 * as well as to handle reading / writing of string data
 * to the underlying buffer.
 *
 **********************************************************/
var reader = function (name, size) {
	return function () {
		if (this._index + size > this._length) {
			throw new Error('Trying to read past the end of the stream');
		}
		var val = this._view[name](this._index);
		this._index += size;
		return val;
	};
};

var writer = function (name, size) {
	return function (value) {
		this._view[name](this._index, value);
		this._index += size;
	};
};

function readASCIIString(stream, bytes) {
	return readString(stream, bytes, false);
}

function readUTF8String(stream, bytes) {
	return readString(stream, bytes, true);
}

function readString(stream, bytes, utf8) {
	if (bytes === 0) {
		return '';
	}
	var i = 0;
	var chars = [];
	var append = true;
	var fixedLength = !!bytes;
	if (!bytes) {
		bytes = Math.floor((stream._length - stream._index) / 8);
	}

	// Read while we still have space available, or until we've
	// hit the fixed byte length passed in.
	while (i < bytes) {
		var c = stream.readUint8();

		// Stop appending chars once we hit 0x00
		if (c === 0x00) {
			append = false;

			// If we don't have a fixed length to read, break out now.
			if (!fixedLength) {
				break;
			}
		}
		if (append) {
			chars.push(c);
		}

		i++;
	}

	var string = String.fromCharCode.apply(null, chars);
	if (utf8) {
		try {
			return decodeURIComponent(escape(string)); // https://stackoverflow.com/a/17192845
		} catch (e) {
			return string;
		}
	} else {
		return string;
	}
}

function writeASCIIString(stream, string, bytes) {
	var length = bytes || string.length + 1;  // + 1 for NULL

	for (var i = 0; i < length; i++) {
		stream.writeUint8(i < string.length ? string.charCodeAt(i) : 0x00);
	}
}

function writeUTF8String(stream, string, bytes) {
	var byteArray = stringToByteArray(string);

	var length = bytes || byteArray.length + 1;  // + 1 for NULL
	for (var i = 0; i < length; i++) {
		stream.writeUint8(i < byteArray.length ? byteArray[i] : 0x00);
	}
}

function stringToByteArray(str) { // https://gist.github.com/volodymyr-mykhailyk/2923227
	var b = [], i, unicode;
	for (i = 0; i < str.length; i++) {
		unicode = str.charCodeAt(i);
		// 0x00000000 - 0x0000007f -> 0xxxxxxx
		if (unicode <= 0x7f) {
			b.push(unicode);
			// 0x00000080 - 0x000007ff -> 110xxxxx 10xxxxxx
		} else if (unicode <= 0x7ff) {
			b.push((unicode >> 6) | 0xc0);
			b.push((unicode & 0x3F) | 0x80);
			// 0x00000800 - 0x0000ffff -> 1110xxxx 10xxxxxx 10xxxxxx
		} else if (unicode <= 0xffff) {
			b.push((unicode >> 12) | 0xe0);
			b.push(((unicode >> 6) & 0x3f) | 0x80);
			b.push((unicode & 0x3f) | 0x80);
			// 0x00010000 - 0x001fffff -> 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
		} else {
			b.push((unicode >> 18) | 0xf0);
			b.push(((unicode >> 12) & 0x3f) | 0x80);
			b.push(((unicode >> 6) & 0x3f) | 0x80);
			b.push((unicode & 0x3f) | 0x80);
		}
	}

	return b;
}

var BitStream = function (source, byteOffset, byteLength) {
	var isBuffer = source instanceof ArrayBuffer ||
		(typeof Buffer !== 'undefined' && source instanceof Buffer);

	if (!(source instanceof BitView) && !isBuffer) {
		throw new Error('Must specify a valid BitView, ArrayBuffer or Buffer');
	}

	if (isBuffer) {
		this._view = new BitView(source, byteOffset, byteLength);
	} else {
		this._view = source;
	}

	this._index = 0;
	this._startIndex = 0;
	this._length = this._view.byteLength * 8;
};

Object.defineProperty(BitStream.prototype, 'index', {
	get: function () { return this._index - this._startIndex; },
	set: function (val) { this._index = val + this._startIndex; },
	enumerable: true,
	configurable: true
});

Object.defineProperty(BitStream.prototype, 'length', {
	get: function () { return this._length - this._startIndex; },
	set: function (val) { this._length = val + this._startIndex; },
	enumerable  : true,
	configurable: true
});

Object.defineProperty(BitStream.prototype, 'bitsLeft', {
	get: function () { return this._length - this._index; },
	enumerable  : true,
	configurable: true
});

Object.defineProperty(BitStream.prototype, 'byteIndex', {
	// Ceil the returned value, over compensating for the amount of
	// bits written to the stream.
	get: function () { return Math.ceil(this._index / 8); },
	set: function (val) { this._index = val * 8; },
	enumerable: true,
	configurable: true
});

Object.defineProperty(BitStream.prototype, 'buffer', {
	get: function () { return this._view.buffer; },
	enumerable: true,
	configurable: false
});

Object.defineProperty(BitStream.prototype, 'view', {
	get: function () { return this._view; },
	enumerable: true,
	configurable: false
});

Object.defineProperty(BitStream.prototype, 'bigEndian', {
	get: function () { return this._view.bigEndian; },
	set: function (val) { this._view.bigEndian = val; },
	enumerable: true,
	configurable: false
});

BitStream.prototype.readBits = function (bits, signed) {
	var val = this._view.getBits(this._index, bits, signed);
	this._index += bits;
	return val;
};

BitStream.prototype.writeBits = function (value, bits) {
	this._view.setBits(this._index, value, bits);
	this._index += bits;
};

BitStream.prototype.readBoolean = reader('getBoolean', 1);
BitStream.prototype.readInt8 = reader('getInt8', 8);
BitStream.prototype.readUint8 = reader('getUint8', 8);
BitStream.prototype.readInt16 = reader('getInt16', 16);
BitStream.prototype.readUint16 = reader('getUint16', 16);
BitStream.prototype.readInt32 = reader('getInt32', 32);
BitStream.prototype.readUint32 = reader('getUint32', 32);
BitStream.prototype.readFloat32 = reader('getFloat32', 32);
BitStream.prototype.readFloat64 = reader('getFloat64', 64);

BitStream.prototype.writeBoolean = writer('setBoolean', 1);
BitStream.prototype.writeInt8 = writer('setInt8', 8);
BitStream.prototype.writeUint8 = writer('setUint8', 8);
BitStream.prototype.writeInt16 = writer('setInt16', 16);
BitStream.prototype.writeUint16 = writer('setUint16', 16);
BitStream.prototype.writeInt32 = writer('setInt32', 32);
BitStream.prototype.writeUint32 = writer('setUint32', 32);
BitStream.prototype.writeFloat32 = writer('setFloat32', 32);
BitStream.prototype.writeFloat64 = writer('setFloat64', 64);

BitStream.prototype.readASCIIString = function (bytes) {
	return readASCIIString(this, bytes);
};

BitStream.prototype.readUTF8String = function (bytes) {
	return readUTF8String(this, bytes);
};

BitStream.prototype.writeASCIIString = function (string, bytes) {
	writeASCIIString(this, string, bytes);
};

BitStream.prototype.writeUTF8String = function (string, bytes) {
	writeUTF8String(this, string, bytes);
};
BitStream.prototype.readBitStream = function(bitLength) {
	var slice = new BitStream(this._view);
	slice._startIndex = this._index;
	slice._index = this._index;
	slice.length = bitLength;
	this._index += bitLength;
	return slice;
};

BitStream.prototype.writeBitStream = function(stream, length) {
	if (!length) {
		length = stream.bitsLeft;
	}

	var bitsToWrite;
	while (length > 0) {
		bitsToWrite = Math.min(length, 32);
		this.writeBits(stream.readBits(bitsToWrite), bitsToWrite);
		length -= bitsToWrite;
	}
};

BitStream.prototype.readArrayBuffer = function(byteLength) {
	var buffer = this._view.getArrayBuffer(this._index, byteLength);
	this._index += (byteLength * 8);
	return buffer;
};

BitStream.prototype.writeArrayBuffer = function(buffer, byteLength) {
	this.writeBitStream(new BitStream(buffer), byteLength * 8);
};


BitStream.prototype.readBitsAsBytes = function (bits) {
	const ret = [];

	while (bits >= 8) {
		ret.push(this.readUint8());
		bits -= 8;
	}
	if (bits > 0) {
		ret.push(this.readBits(bits));
	}

	return ret;
};

BitStream.prototype.readBytes = function (bytes) {
	const arr = new Array(bytes);
	for (let i = 0; i < bytes; ++i) {
		arr[i] = this.readUint8();
	}
	return Buffer.from(arr);
};

BitStream.prototype.readOneBit = function () {
	return this.readBits(1, false) === 1;
};

BitStream.prototype.readArrayBuffer = function (bits) {
	const bytes = Math.ceil(bits / 8);
	const result = Buffer.from(new Uint8Array(bytes));
	let offset = 0;
	while (bits > 0) {
		// read up to 8 bits at a time (we may read less at the end if not aligned)
		const bitsToRead = Math.min(bits, 8);
		result.writeUInt8(this.readBits(bitsToRead), offset);
		offset += 1;
		bits -= bitsToRead;
	}
	return result;
};

BitStream.prototype.readUBitVarFieldPath = function () {
	if (this.readBoolean()) {
		return this.readBits(2);
	}
	if (this.readBoolean()) {
		return this.readBits(4);
	}
	if (this.readBoolean()) {
		return this.readBits(10);
	}
	if (this.readBoolean()) {
		return this.readBits(17);
	}
	return this.readBits(31);

};

BitStream.prototype.readnBits = function (n) {
	const bits = this.readBits(n);
	return bits & MASKS[n];
};

BitStream.prototype.readnBytes = function (n) {
	let bytes = [];
	bytes = this.readBytes(n);
};

BitStream.prototype.readUBits = BitStream.prototype.readBits;

BitStream.prototype.readSBits = function (bits) {
	return this.readBits(bits, true);
};

BitStream.prototype.readUBitVar = function () {
	let ret = this.readBits(6);

	switch (ret & 0x30) {
		case 16:
			ret = (ret & 15) | (this.readBits(4) << 4);
			break;

		case 32:
			ret = (ret & 15) | (this.readBits(8) << 4);
			break;

		case 48:
			ret = (ret & 15) | (this.readBits(28) << 4);
			break;
	}

	return ret;
};

BitStream.prototype.readBitCoord = function () {
	let value = 0.0;

	let intval = this.readBits(1);
	let fractval = this.readBits(1);

	if (intval !== 0 || fractval !== 0) {

		const signbit = this.readBoolean();

		if (intval !== 0) {
			intval = this.readUBits(COORD_INTEGER_BITS) + 1;
		}

		if (fractval !== 0) {
			fractval = this.readUBits(COORD_FRACTIONAL_BITS);
		}

		value = intval + fractval * COORD_RESOLUTION;

		if (signbit) {
			value = -value;
		}
	}

	return value;
};

// credit to LaihoE, the outer function that calls this
// checks the presence of the value, so should now just read it
BitStream.prototype.readBitCoordPrecise = function () {
	const signbit = this.readBoolean();
	const intVal = this.readBits(COORD_INTEGER_BITS);
	const fracVal = this.readnBits(COORD_FRACTIONAL_BITS);

	const resol = 1.0 / (1 << 5);
	let result = (intVal + (fracVal * resol));

	if (signbit) {
		return -result;
	}

	return result;
};

BitStream.prototype.readUVarInt32 = function () {
	let result = 0;
	let count = 0;
	let bytes;

	do {
		bytes = this.readBits(8);
		result |= (bytes & 127) << (7 * count);
		++count;
	} while (count < MAX_VAR_INT32_BYTES && (bytes & 0x80) !== 0);

	return result;
};

BitStream.prototype.readOneByte = function () {
	return this.readBytes(1)[0];
};

BitStream.prototype.readVarInt32 = function () {
	const result = this.readUVarInt32();
	return (result >> 1) ^ -(result & 1);
};

BitStream.prototype.readBitCoordMPNone = function () {
	const inBounds = this.readOneBit();
	let intval = this.readOneBit() ? 1 : 0;
	const signbit = this.readOneBit();

	if (intval) {
		if (inBounds) {
			intval = this.readUBits(COORD_INTEGER_BITS_MP) + 1;
		} else {
			intval = this.readUBits(COORD_INTEGER_BITS) + 1;
		}
	}

	const fractval = this.readUBits(COORD_FRACTIONAL_BITS);

	let value = intval + fractval * COORD_RESOLUTION;

	if (signbit) {
		value = -value;
	}

	return value;
};

BitStream.prototype.readBitCoordMPLowPrecision = function () {
	const inBounds = this.readOneBit();
	let intval = this.readOneBit() ? 1 : 0;
	const signbit = this.readOneBit();

	if (intval) {
		if (inBounds) {
			intval = this.readUBits(COORD_INTEGER_BITS_MP) + 1;
		} else {
			intval = this.readUBits(COORD_INTEGER_BITS) + 1;
		}
	}

	const fractval = this.readUBits(COORD_FRACTIONAL_BITS_MP_LOWPRECISION);

	let value = intval + fractval * COORD_RESOLUTION_LOWPRECISION;

	if (signbit) {
		value = -value;
	}

	return value;
};

BitStream.prototype.readBitCoordMPIntegral = function () {
	const inBounds = this.readOneBit();
	if (!this.readOneBit()) {
		return 0.0;
	}

	const signbit = this.readOneBit();

	let value;
	if (inBounds) {
		value = this.readUBits(COORD_INTEGER_BITS_MP) + 1;
	} else {
		value = this.readUBits(COORD_INTEGER_BITS) + 1;
	}

	if (signbit) {
		value = -value;
	}

	return value;
};

BitStream.prototype.readBitNormal = function () {
	const signbit = this.readBoolean();

	const fractval = this.readUBits(NORMAL_FRACTIONAL_BITS);

	let value = fractval * NORMAL_RESOLUTION;

	if (signbit) {
		value = -value;
	}

	return value;
};

BitStream.prototype.read3BitNormal = function () {
	const ret = [0, 0, 0];

	const hasX = this.readBoolean();
	const hasY = this.readBoolean();

	if (hasX) {
		ret[0] = this.readBitNormal();
	}

	if (hasY) {
		ret[1] = this.readBitNormal();
	}

	const signbit = this.readBoolean();
	const prodsum = ret[0] * ret[0] - ret[1] * ret[1];

	if (prodsum < 1.0) {
		ret[2] = Math.sqrt(1.0 - prodsum);
	} else {
		ret[2] = 0.0;
	}

	if (signbit) {
		ret[2] = -ret[2];
	}

	return ret;
};

BitStream.prototype.readBitCellCoordNone = function (bits) {
	const intval = this.readUBits(bits);
	const fractval = this.readUBits(COORD_FRACTIONAL_BITS);
	return intval + fractval * COORD_RESOLUTION;
};

BitStream.prototype.readBitCellCoordLowPrecision = function (bits) {
	const intval = this.readUBits(bits);
	const fractval = this.readUBits(COORD_FRACTIONAL_BITS_MP_LOWPRECISION);
	return intval + fractval * COORD_RESOLUTION_LOWPRECISION;
};

BitStream.prototype.readBitCellCoordIntegral = function (bits) {
	return this.readUBits(bits);
};

BitStream.prototype.readCString = function () {
	let s = '';

	while (true) {
		const c = this.readUInt8();

		// Stop appending chars once we hit 0x00
		if (c === 0x00) {
			break;
		}

		s += String.fromCharCode(c);
	}

	return s;
};

BitStream.prototype.readLeUint64 = function () {
	const bytes = this.readBytes(8);
	return bytes.readBigUint64LE();
};

BitStream.prototype.readVarUint64 = function () {
	// Copyright 2023 Skye van Boheemen. All rights reserved. MIT license.
	let value = 0n;
	let length = 0;
	while (true) {
		const currentByte = BigInt(this.readOneByte());
		value |= (currentByte & 0x7Fn) << 7n * BigInt(length);
		length++;
		if (length > 10) throw new Error("Max Length Reached");

		if ((currentByte & 0x80n) !== 0x80n) break;
	}

	return value;
};

BitStream.from = function from(array) {
	return new BitStream(array.buffer, array.byteOffset, array.byteLength);
};

// AMD / RequireJS
if (typeof define !== 'undefined' && define.amd) {
	define(function () {
		return {
			BitView: BitView,
			BitStream
		};
	});
}
// Node.js
else if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		BitView: BitView,
		BitStream
	};
}

}(this));
