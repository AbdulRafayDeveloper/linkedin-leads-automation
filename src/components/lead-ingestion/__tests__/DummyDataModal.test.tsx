import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DummyDataModal from '../DummyDataModal';
import type { SampleProfileRecord } from '@/services/sample-profiles/sampleProfilesApi';

const listSamplesApi = jest.fn();
const createSampleApi = jest.fn();
const updateSampleApi = jest.fn();
const deleteSampleApi = jest.fn();

jest.mock('@/services/sample-profiles/sampleProfilesApi', () => ({
  listSamplesApi: () => listSamplesApi(),
  createSampleApi: (input: unknown) => createSampleApi(input),
  updateSampleApi: (id: string, input: unknown) => updateSampleApi(id, input),
  deleteSampleApi: (id: string) => deleteSampleApi(id),
}));

const SAMPLES: SampleProfileRecord[] = [
  { id: 's1', title: 'Mark Allen — DevOps Engineer', content: 'Mark Allen\nDevOps Engineer at Helix', updatedAt: '2026-10-14T10:00:00.000Z' },
  { id: 's2', title: 'Shannon Lal — VP Technology', content: 'Shannon Lal\nVP Technology and Engineering', updatedAt: '2026-10-14T10:05:00.000Z' },
];

const onClose = jest.fn();
const onUse = jest.fn();
const writeText = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  listSamplesApi.mockResolvedValue(SAMPLES);
  Object.assign(navigator, { clipboard: { writeText } });
});

const openModal = () => render(<DummyDataModal open onClose={onClose} onUse={onUse} />);

describe('Dummy data dialog', () => {
  it('lists the saved samples with their size', async () => {
    openModal();
    expect(await screen.findByText('Mark Allen — DevOps Engineer')).toBeInTheDocument();
    expect(screen.getByText('Shannon Lal — VP Technology')).toBeInTheDocument();
    expect(screen.getByText('2 samples')).toBeInTheDocument();
    expect(screen.getAllByText(/chars$/)).toHaveLength(2);
  });

  it('hands the text to the New Lead box with "Use this"', async () => {
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');

    await userEvent.click(screen.getAllByRole('button', { name: /use this/i })[0]);

    expect(onUse).toHaveBeenCalledWith(SAMPLES[0].content);
  });

  it('copies a sample to the clipboard and says so', async () => {
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');

    await userEvent.click(screen.getAllByRole('button', { name: /^copy$/i })[0]);

    expect(writeText).toHaveBeenCalledWith(SAMPLES[0].content);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('adds a new sample', async () => {
    createSampleApi.mockResolvedValue({ id: 's3', title: 'My paste', content: 'Jane Doe\nCTO', updatedAt: '2026-10-14T11:00:00.000Z' });
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');

    await userEvent.click(screen.getByRole('button', { name: /add sample/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'My paste');
    await userEvent.type(screen.getByLabelText('Profile text'), 'Jane Doe\nCTO');
    await userEvent.click(screen.getByRole('button', { name: /^add sample$/i }));

    await waitFor(() => expect(createSampleApi).toHaveBeenCalledWith({ title: 'My paste', content: 'Jane Doe\nCTO' }));
    expect(await screen.findByText('My paste')).toBeInTheDocument();
  });

  it('will not save a sample without a name or text', async () => {
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');
    await userEvent.click(screen.getByRole('button', { name: /add sample/i }));

    expect(screen.getByRole('button', { name: /^add sample$/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name'), 'Only a name');
    expect(screen.getByRole('button', { name: /^add sample$/i })).toBeDisabled();
  });

  it('edits a sample and shows the new name', async () => {
    updateSampleApi.mockResolvedValue({ ...SAMPLES[0], title: 'Renamed sample' });
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');

    await userEvent.click(screen.getByRole('button', { name: /edit mark allen/i }));
    const title = screen.getByLabelText('Name');
    expect(title).toHaveValue(SAMPLES[0].title);
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed sample');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateSampleApi).toHaveBeenCalledWith('s1', expect.objectContaining({ title: 'Renamed sample' })));
    expect(await screen.findByText('Renamed sample')).toBeInTheDocument();
  });

  it('asks before deleting, then removes the sample', async () => {
    deleteSampleApi.mockResolvedValue(undefined);
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');

    await userEvent.click(screen.getByRole('button', { name: /delete mark allen/i }));
    const dialog = await screen.findByText('Delete this sample?');
    expect(dialog).toBeInTheDocument();
    expect(deleteSampleApi).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deleteSampleApi).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByText('Mark Allen — DevOps Engineer')).not.toBeInTheDocument());
  });

  it('keeps the sample when the delete is cancelled', async () => {
    openModal();
    await screen.findByText('Mark Allen — DevOps Engineer');
    await userEvent.click(screen.getByRole('button', { name: /delete mark allen/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(deleteSampleApi).not.toHaveBeenCalled();
    expect(screen.getByText('Mark Allen — DevOps Engineer')).toBeInTheDocument();
  });

  it('reports a failure instead of silently doing nothing', async () => {
    listSamplesApi.mockRejectedValue(new Error('Could not reach the server. Check your connection and try again.'));
    openModal();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('explains the empty state', async () => {
    listSamplesApi.mockResolvedValue([]);
    openModal();

    expect(await screen.findByText('No samples saved.')).toBeInTheDocument();
  });
});
