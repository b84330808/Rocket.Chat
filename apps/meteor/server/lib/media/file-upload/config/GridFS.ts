import type * as http from 'node:http';
import stream from 'node:stream';
import zlib from 'node:zlib';

import type { IUpload } from '@rocket.chat/core-typings';

import { getContentDisposition } from './helper';
import { UploadFS } from '../../../../ufs';
import { FileUploadClass, FileUpload } from '../lib/FileUpload';
import { getFileRange, setRangeHeaders } from '../lib/ranges';

// code from: https://github.com/jalik/jalik-ufs/blob/master/ufs-server.js#L310
const readFromGridFS = async function (
	storeName: string | undefined,
	fileId: string,
	file: IUpload,
	req: http.IncomingMessage,
	res: http.ServerResponse,
) {
	if (!storeName) {
		return;
	}
	const store = UploadFS.getStore(storeName);

	res.setHeader('Accept-Ranges', 'bytes');

	const range = getFileRange(file, req);
	if (range) {
		setRangeHeaders(range, file, res);

		if (range.outOfRange) {
			return;
		}
	}

	const rs = await store.getReadStream(fileId, file, range && { start: range.start, end: range.stop });
	const ws = new stream.PassThrough();

	[rs, ws].forEach((stream) =>
		stream.on('error', (err) => {
			store.onReadError.call(store, err, fileId, file);
			res.end();
		}),
	);

	ws.on('close', () => {
		// Close output stream at the end
		ws.emit('end');
	});

	// Transform stream
	store.transformRead(rs, ws, fileId, file, req);

	if (range) {
		ws.pipe(res);
		return;
	}

	const accept = (Array.isArray(req.headers['accept-encoding']) ? req.headers['accept-encoding'][0] : req.headers['accept-encoding']) || '';

	// Compress data using gzip
	if (accept.match(/\bgzip\b/)) {
		res.setHeader('Content-Encoding', 'gzip');
		res.removeHeader('Content-Length');
		res.writeHead(200);
		ws.pipe(zlib.createGzip()).pipe(res);
		return;
	}

	// Compress data using deflate
	if (accept.match(/\bdeflate\b/)) {
		res.setHeader('Content-Encoding', 'deflate');
		res.removeHeader('Content-Length');
		res.writeHead(200);
		ws.pipe(zlib.createDeflate()).pipe(res);
		return;
	}

	res.writeHead(200);
	ws.pipe(res);
};

const copyFromGridFS = async function (storeName: string | undefined, fileId: string, file: IUpload, out: stream.Writable) {
	if (!storeName) {
		return;
	}

	const store = UploadFS.getStore(storeName);
	const rs = await store.getReadStream(fileId, file);

	[rs, out].forEach((stream) =>
		stream.on('error', (err) => {
			store.onReadError.call(store, err, fileId, file);
			out.end();
		}),
	);

	rs.pipe(out);
};

FileUpload.configureUploadsStore('GridFS', 'GridFS:Uploads', {
	collectionName: 'rocketchat_uploads',
});

FileUpload.configureUploadsStore('GridFS', 'GridFS:UserDataFiles', {
	collectionName: 'rocketchat_userDataFiles',
});

FileUpload.configureUploadsStore('GridFS', 'GridFS:Avatars', {
	collectionName: 'rocketchat_avatars',
});

new FileUploadClass({
	name: 'GridFS:Uploads',

	async get(file, req, res) {
		file = FileUpload.addExtensionTo(file);

		res.setHeader('Content-Disposition', `${getContentDisposition(req)}; filename*=UTF-8''${encodeURIComponent(file.name || '')}`);
		file.uploadedAt && res.setHeader('Last-Modified', file.uploadedAt.toUTCString());
		res.setHeader('Content-Type', file.type || 'application/octet-stream');
		res.setHeader('Content-Length', file.size || 0);

		await readFromGridFS(file.store, file._id, file, req, res);
	},

	async copy(file, out) {
		await copyFromGridFS(file.store, file._id, file, out);
	},
});

new FileUploadClass({
	name: 'GridFS:UserDataFiles',

	async get(file, req, res) {
		file = FileUpload.addExtensionTo(file);

		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name || '')}`);
		file.uploadedAt && res.setHeader('Last-Modified', file.uploadedAt.toUTCString());
		res.setHeader('Content-Type', file.type || '');
		res.setHeader('Content-Length', file.size || 0);

		await readFromGridFS(file.store, file._id, file, req, res);
	},

	async copy(file, out) {
		await copyFromGridFS(file.store, file._id, file, out);
	},
});

new FileUploadClass({
	name: 'GridFS:Avatars',

	async get(file, req, res) {
		file = FileUpload.addExtensionTo(file);

		await readFromGridFS(file.store, file._id, file, req, res);
	},

	async copy(file, out) {
		await copyFromGridFS(file.store, file._id, file, out);
	},
});
