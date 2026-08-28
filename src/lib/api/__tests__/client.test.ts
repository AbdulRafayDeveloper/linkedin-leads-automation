import {
  bulkDeleteLeadsApi,
  deleteLeadApi,
  enrichLeadApi,
  fetchLead,
  fetchLeads,
  processLeadApi,
  updateLeadApi,
} from '../client';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

describe('api client', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('fetchLeads builds query params and returns the parsed body', async () => {
    mockFetchOnce({ success: true, leads: [], total: 0, page: 1, pages: 1 });
    const result = await fetchLeads({ page: 2, search: 'gus' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('search=gus'));
    expect(result.total).toBe(0);
  });

  it('fetchLead requests a single lead by ID', async () => {
    mockFetchOnce({ success: true, lead: { _id: '1' } });
    const result = await fetchLead('1');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/leads/1'));
    expect(result.lead._id).toBe('1');
  });

  it('updateLeadApi sends a PUT request with the updates', async () => {
    mockFetchOnce({ success: true, lead: { _id: '1', approvalStatus: 'APPROVED' } });
    await updateLeadApi('1', { approvalStatus: 'APPROVED' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/leads/1'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('deleteLeadApi sends a DELETE request', async () => {
    mockFetchOnce({ success: true, lead: { _id: '1' } });
    await deleteLeadApi('1');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/leads/1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('bulkDeleteLeadsApi sends ids in the request body', async () => {
    mockFetchOnce({ success: true, deletedCount: 2 });
    const result = await bulkDeleteLeadsApi(['1', '2']);
    expect(result.deletedCount).toBe(2);
  });

  it('processLeadApi posts pasted content', async () => {
    mockFetchOnce({ success: true, result: {}, lead: { _id: '1' } });
    const result = await processLeadApi('pasted content');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/process'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.lead._id).toBe('1');
  });

  it('enrichLeadApi posts to the enrich endpoint for a lead', async () => {
    mockFetchOnce({ success: true, lead: { _id: '1', enrichmentStatus: 'QUEUED' } });
    const result = await enrichLeadApi('1');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/leads/1/enrich'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.lead.enrichmentStatus).toBe('QUEUED');
  });

  it('throws when the API responds with success: false', async () => {
    mockFetchOnce({ success: false, error: 'Bad request' }, true, 400);
    await expect(fetchLead('missing')).rejects.toThrow('Bad request');
  });

  it('throws a generic error when the response is not ok and has no error message', async () => {
    mockFetchOnce({}, false, 500);
    await expect(fetchLead('1')).rejects.toThrow('Request failed with status 500');
  });
});
