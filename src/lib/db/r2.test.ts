import { describe, it, expect } from "vitest";
import { parseListObjectsXml, shardForChunk } from "./r2";

describe("parseListObjectsXml", () => {
  it("extracts key + size for every Contents block", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>securewarp-shard-0</Name>
  <Prefix>u/f/v1/</Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>u/f/v1/chunk-0</Key>
    <LastModified>2026-09-14T00:00:00.000Z</LastModified>
    <ETag>"abc"</ETag>
    <Size>4194320</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <Contents>
    <Key>u/f/v1/chunk-5</Key>
    <LastModified>2026-09-14T00:00:00.000Z</LastModified>
    <ETag>"def"</ETag>
    <Size>17</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`;
    const out = parseListObjectsXml(xml);
    expect(out.objects).toEqual([
      { key: "u/f/v1/chunk-0", size: 4194320 },
      { key: "u/f/v1/chunk-5", size: 17 },
    ]);
    expect(out.nextContinuationToken).toBeNull();
  });

  it("returns the continuation token only when truncated", () => {
    const truncated = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>abc&amp;def</NextContinuationToken></ListBucketResult>`;
    expect(parseListObjectsXml(truncated).nextContinuationToken).toBe("abc&def");
    const done = `<ListBucketResult><IsTruncated>false</IsTruncated><NextContinuationToken>stale</NextContinuationToken></ListBucketResult>`;
    expect(parseListObjectsXml(done).nextContinuationToken).toBeNull();
  });

  it("skips malformed blocks and unescapes keys", () => {
    const xml = `<ListBucketResult>
      <Contents><Key>a&amp;b/c</Key><Size>1</Size></Contents>
      <Contents><Key>no-size</Key></Contents>
      <Contents><Size>2</Size></Contents>
      <Contents><Key>neg</Key><Size>-1</Size></Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;
    expect(parseListObjectsXml(xml).objects).toEqual([{ key: "a&b/c", size: 1 }]);
  });

  it("handles an empty listing", () => {
    expect(parseListObjectsXml(`<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>`)).toEqual({
      objects: [],
      nextContinuationToken: null,
    });
  });
});

describe("shardForChunk", () => {
  it("is deterministic round-robin", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(shardForChunk)).toEqual([0, 1, 2, 3, 4, 0, 1]);
  });
});
