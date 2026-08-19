// SPDX-License-Identifier: AGPL-3.0-or-later

import type {IpAddressFamily, ParsedIpAddress} from '@fluxer/ip_utils/src/IpAddress';
import {isInternalIpAddress, parseIpAddress} from '@fluxer/ip_utils/src/IpAddress';

interface ClientIpExtractionOptions {
	trustClientIpHeader?: boolean;
	clientIpHeaderName?: string;
}

type ClientIpSource = 'client-ip-header' | 'cloudflare-header';

interface ExtractedClientIp {
	ip: string;
	source: ClientIpSource;
	ipVersion: IpAddressFamily;
}

interface HeadersLike {
	[key: string]: string | Array<string> | undefined;
}

export class MissingClientIpError extends Error {
	constructor() {
		super('Client IP header is required');
		this.name = 'MissingClientIpError';
	}
}

interface HeaderReader {
	get(name: string): string | null;
}

const DEFAULT_CLIENT_IP_HEADER_NAME = 'x-forwarded-for';

/**
 * A Cloudflare Tunnel connector does not forward the visitor's address in the
 * forwarding header, so the chain reaching the origin holds only the addresses the
 * deployment's own proxies added — the connector's, then each proxy in front of the
 * service. Cloudflare puts the visitor's address here instead, so this is read as a
 * fallback rather than the configured header being ignored: the operator's choice of
 * header still wins whenever it carries a real client.
 */
const CLOUDFLARE_HEADER_NAME = 'cf-connecting-ip';

function normalizeHeaderName(headerName: string): string {
	return headerName.trim().toLowerCase();
}

export function resolveClientIpHeaderName(clientIpHeaderName?: string): string {
	return normalizeHeaderName(clientIpHeaderName ?? DEFAULT_CLIENT_IP_HEADER_NAME);
}

function toStringHeaderValue(value: string | Array<string> | null | undefined): string | null {
	if (Array.isArray(value)) {
		const first = value[0];
		return typeof first === 'string' ? first : null;
	}
	return typeof value === 'string' ? value : null;
}

function parseSingleIpValue(value: string): ParsedIpAddress | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return parseIpAddress(trimmed);
}

function parseClientIpHeaderValue(value: string | null): ParsedIpAddress | null {
	if (value === null) {
		return null;
	}
	const [firstHop] = value.split(',');
	if (firstHop === undefined) {
		return null;
	}
	return parseSingleIpValue(firstHop);
}

/**
 * Whether every hop in a forwarding chain is an address that only exists inside the
 * deployment. Such a chain was written entirely by the deployment's own proxies and
 * says nothing about who made the request. An empty or absent chain counts too.
 */
function isInternalOnlyChain(value: string | null): boolean {
	if (value === null) {
		return true;
	}
	return value.split(',').every((hop) => {
		const address = parseSingleIpValue(hop);
		return address === null || isInternalIpAddress(address.normalized);
	});
}

function createRequestHeaderReader(request: Request): HeaderReader {
	return {
		get: (name: string): string | null => {
			return request.headers.get(name);
		},
	};
}

function getHeaderValue(headers: HeadersLike, name: string): string | null {
	const lowerName = name.toLowerCase();
	const directMatch = toStringHeaderValue(headers[lowerName]);
	if (directMatch !== null) {
		return directMatch;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) {
			return toStringHeaderValue(value);
		}
	}
	return null;
}

function createNodeHeaderReader(headers: HeadersLike): HeaderReader {
	return {
		get: (name: string): string | null => {
			return getHeaderValue(headers, name);
		},
	};
}

function toExtractedClientIp(address: ParsedIpAddress, source: ClientIpSource): ExtractedClientIp {
	return {
		ip: address.normalized,
		source,
		ipVersion: address.family,
	};
}

function extractClientIpDetailsFromReader(
	headerReader: HeaderReader,
	options?: ClientIpExtractionOptions,
): ExtractedClientIp | null {
	if (!options?.trustClientIpHeader) {
		return null;
	}
	const headerName = resolveClientIpHeaderName(options.clientIpHeaderName);
	const configuredHeader = headerReader.get(headerName);
	// A chain made up entirely of internal addresses never reached the visitor: it is
	// the deployment's own proxies talking to each other, which is what a request
	// arriving through a Cloudflare Tunnel connector looks like.
	if (headerName !== CLOUDFLARE_HEADER_NAME && isInternalOnlyChain(configuredHeader)) {
		const cloudflareHop = parseSingleIpValue(headerReader.get(CLOUDFLARE_HEADER_NAME) ?? '');
		if (cloudflareHop) {
			return toExtractedClientIp(cloudflareHop, 'cloudflare-header');
		}
	}
	const clientIpHeader = parseClientIpHeaderValue(configuredHeader);
	if (clientIpHeader) {
		return toExtractedClientIp(clientIpHeader, 'client-ip-header');
	}
	return null;
}

export function extractClientIpDetails(req: Request, options?: ClientIpExtractionOptions): ExtractedClientIp | null {
	return extractClientIpDetailsFromReader(createRequestHeaderReader(req), options);
}

export function extractClientIp(req: Request, options?: ClientIpExtractionOptions): string | null {
	const extracted = extractClientIpDetails(req, options);
	return extracted?.ip ?? null;
}

export function requireClientIp(req: Request, options?: ClientIpExtractionOptions): string {
	const ip = extractClientIp(req, options);
	if (!ip) {
		throw new MissingClientIpError();
	}
	return ip;
}

export function extractClientIpDetailsFromHeaders(
	headers: HeadersLike,
	options?: ClientIpExtractionOptions,
): ExtractedClientIp | null {
	return extractClientIpDetailsFromReader(createNodeHeaderReader(headers), options);
}

export function extractClientIpFromHeaders(headers: HeadersLike, options?: ClientIpExtractionOptions): string | null {
	const extracted = extractClientIpDetailsFromHeaders(headers, options);
	return extracted?.ip ?? null;
}
