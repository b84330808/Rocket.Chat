import type * as http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { beforeEach, describe, it } from 'node:test';

import { expect } from 'chai';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

const getReadStream = sinon.stub();
const store = {
	getReadStream,
	transformRead: (rs: Readable, ws: PassThrough) => rs.pipe(ws),
	onReadError: sinon.stub(),
};

const fileUploadClasses: Record<string, { get: (file: unknown, req: unknown, res: unknown) => Promise<void> }> = {};

proxyquire.noCallThru().load('./GridFS', {
	'../../../../ufs': { UploadFS: { getStore: () => store } },
	'../lib/FileUpload': {
		FileUpload: { configureUploadsStore: sinon.stub(), addExtensionTo: (file: unknown) => file },
		FileUploadClass: class {
			constructor(options: { name: string; get: (file: unknown, req: unknown, res: unknown) => Promise<void> }) {
				fileUploadClasses[options.name] = options;
			}
		},
	},
});

class FakeResponse extends PassThrough {
	statusCode = 200;

	private headers: Record<string, unknown> = {};

	setHeader(name: string, value: unknown) {
		this.headers[name.toLowerCase()] = value;
		return this;
	}

	getHeader(name: string) {
		return this.headers[name.toLowerCase()];
	}

	removeHeader(name: string) {
		delete this.headers[name.toLowerCase()];
	}

	writeHead(statusCode: number) {
		this.statusCode = statusCode;
		return this;
	}
}

const file = { _id: 'file-id', name: 'clip.mp4', type: 'video/mp4', size: content.length, store: 'GridFS:Uploads' };

const request = async (headers: http.IncomingHttpHeaders) => {
	const res = new FakeResponse();
	await fileUploadClasses['GridFS:Uploads'].get({ ...file }, { url: '/file-upload/file-id/clip.mp4', headers }, res);
	return { res, body: await buffer(res) };
};

describe('GridFS:Uploads', () => {
	beforeEach(() => {
		getReadStream.reset();
		getReadStream.callsFake(async (_fileId: string, _file: unknown, options?: { start?: number; end?: number }) =>
			Readable.from([content.subarray(options?.start ?? 0, options?.end === undefined ? content.length : options.end + 1)]),
		);
	});

	it('should read only the requested open-ended range from the store', async () => {
		const { res, body } = await request({ range: 'bytes=600-' });

		expect(getReadStream.calledOnce).to.be.true;
		expect(getReadStream.firstCall.args[2]).to.deep.equal({ start: 600, end: 999 });
		expect(res.statusCode).to.equal(206);
		expect(res.getHeader('Content-Range')).to.equal('bytes 600-999/1000');
		expect(body.equals(content.subarray(600))).to.be.true;
	});

	it('should read only the requested closed range from the store', async () => {
		const { res, body } = await request({ range: 'bytes=0-1' });

		expect(getReadStream.firstCall.args[2]).to.deep.equal({ start: 0, end: 1 });
		expect(res.statusCode).to.equal(206);
		expect(res.getHeader('Content-Range')).to.equal('bytes 0-1/1000');
		expect(body.equals(content.subarray(0, 2))).to.be.true;
	});

	it('should read the whole file when no range is requested', async () => {
		const { res, body } = await request({});

		expect(getReadStream.firstCall.args[2]).to.be.undefined;
		expect(res.statusCode).to.equal(200);
		expect(body.equals(content)).to.be.true;
	});
});
