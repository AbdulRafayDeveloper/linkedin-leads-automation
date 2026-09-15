import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptSettingsPage from '../PromptSettingsPage';
import { getPromptsApi, savePromptApi, type PromptRecord } from '@/services/lead-ingestion/apiClient';

jest.mock('@/services/lead-ingestion/apiClient', () => ({
  getPromptsApi: jest.fn(),
  savePromptApi: jest.fn(),
}));

const prompts: PromptRecord[] = [
  {
    key: 'global_outreach_prompt',
    title: 'Email writing prompt',
    description: 'Who you are and your pitch.',
    stage: 'Step 1 · Writes the email',
    emptyBehavior: 'Empty: the AI writes with its built-in rules only.',
    promptText: 'I am Abdul Rafay.',
    defaultText: 'Default writing text',
    isDefault: false,
    updatedAt: '2026-09-15T10:00:00.000Z',
  },
  {
    key: 'email_format_check_prompt',
    title: 'Email format check prompt',
    description: 'The structure every email must follow.',
    stage: 'Step 2 · Checks the format',
    emptyBehavior: 'Empty: the format check is skipped.',
    promptText: 'Default format rules',
    defaultText: 'Default format rules',
    isDefault: true,
    updatedAt: null,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPromptsApi).mockResolvedValue({ prompts });
  jest.mocked(savePromptApi).mockImplementation(async (key, promptText) => ({
    prompt: { ...prompts.find((prompt) => prompt.key === key)!, promptText, isDefault: false },
  }));
});

describe('PromptSettingsPage', () => {
  it('shows one card per prompt', async () => {
    render(<PromptSettingsPage />);
    expect(await screen.findByRole('button', { name: /Email writing prompt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Email format check prompt/ })).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('opens a prompt in the editor, saves it and closes', async () => {
    render(<PromptSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Email format check prompt/ }));

    const dialog = screen.getByRole('dialog', { name: 'Email format check prompt' });
    const textarea = within(dialog).getByRole('textbox');
    expect(textarea).toHaveValue('Default format rules');

    fireEvent.change(textarea, { target: { value: 'New rules' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(savePromptApi).toHaveBeenCalledWith('email_format_check_prompt', 'New rules');
    expect(screen.getByRole('status')).toHaveTextContent('Email format check prompt saved');
  });

  it('resets the text to the default without saving', async () => {
    render(<PromptSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Email writing prompt/ }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to default' }));
    expect(within(dialog).getByRole('textbox')).toHaveValue('Default writing text');
    expect(savePromptApi).not.toHaveBeenCalled();
  });
});
