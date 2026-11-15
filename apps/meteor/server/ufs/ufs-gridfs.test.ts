import { beforeEach, describe, it } from 'node:test';

import { expect } from 'chai';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

const openDownloadStream = sinon.stub();

const { GridFSStore } = proxyquire.noCallThru().load('./ufs-gridfs', {
	'./ufs': {
		UploadFS: {
			Store: class {
				constructor(public options: unknown) {}
			},
			store: {},
		},
	},
	'../database/utils': {
		db: {},
		GridFSBucket: class {
			openDownloadStream = openDownloadStream;
		},
	},
});

describe('GridFSStore', () => {
	const store = new GridFSStore({ name: 'GridFS:Uploads', collectionName: 'rocketchat_uploads' });

	beforeEach(() => {
		openDownloadStream.reset();
	});

	it('should pass an inclusive byte range to GridFS as an exclusive end', async () => {
		await store.getReadStream('file-id', {}, { start: 600, end: 999 });

		expect(openDownloadStream.calledOnceWith('file-id', { start: 600, end: 1000 })).to.be.true;
	});

	it('should keep a range that ends at the first byte', async () => {
		await store.getReadStream('file-id', {}, { start: 0, end: 0 });

		expect(openDownloadStream.calledOnceWith('file-id', { start: 0, end: 1 })).to.be.true;
	});
});
