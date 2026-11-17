import { RegisterOptions, useForm } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FilterFormControl,
  FilterFormValues,
  toFormValues,
} from '@/components/DashboardFiltersModal/filterFormState';
import { SqlQueryFilterEditForm } from '@/components/DashboardFiltersModal/SqlQueryFilterEditForm';
import { SqlVariablesProvider } from '@/components/SQLEditor/variableCompletions';

const mockUseSqlQueryFilterValues = jest.fn();
const mockCompletionLabels: string[] = [];
let mockSources: TSource[] = [];

const logSource = (id: string, connection: string): TSource => ({
  id,
  name: id,
  kind: SourceKind.Log,
  connection,
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '',
});

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSources: () => ({ data: mockSources }),
}));
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: ({
    control,
    name,
  }: {
    control: FilterFormControl;
    name: 'source';
  }) => <input data-testid="source-input" {...control.register(name)} />,
}));

jest.mock('@/hooks/useSqlQueryFilterValues', () => ({
  useSqlQueryFilterValues: (...args: unknown[]) =>
    mockUseSqlQueryFilterValues(...args),
}));
// The real selector fetches connections, and the real editor is CodeMirror;
// plain inputs bound to the same fields are enough to drive the preview.
jest.mock('@/components/ConnectionSelect', () => ({
  ConnectionSelectControlled: ({
    control,
    name,
  }: {
    control: FilterFormControl;
    name: 'connection';
  }) => <input data-testid="connection-input" {...control.register(name)} />,
}));
jest.mock('@/components/SQLEditor/SQLEditor', () => ({
  SQLEditorControlled: ({
    control,
    name,
    rules,
    additionalCompletions,
  }: {
    control: FilterFormControl;
    name: 'sqlTemplate';
    rules?: RegisterOptions<FilterFormValues, 'sqlTemplate'>;
    additionalCompletions?: { label: string }[];
  }) => {
    mockCompletionLabels.splice(
      0,
      mockCompletionLabels.length,
      ...(additionalCompletions ?? []).map(c => c.label),
    );
    return (
      <textarea data-testid="sql-input" {...control.register(name, rules)} />
    );
  },
}));

const valuesResult = ({
  values = [],
  error,
  isFetching = false,
}: {
  values?: string[];
  error?: string;
  isFetching?: boolean;
}) => ({
  data: new Map([['preview', { values, isLoading: false }]]),
  filterErrorMessages: new Map(error ? [['preview', error]] : []),
  isLoading: false,
  isFetching,
  isError: !!error,
});

const cloudVariable = { name: 'cloud', expression: 'cloud', values: [] };

function Harness({
  defaultValues,
}: {
  defaultValues?: Partial<FilterFormValues>;
}) {
  const { control, handleSubmit, setValue } = useForm<FilterFormValues>({
    defaultValues: { ...toFormValues(), type: 'SQL_QUERY', ...defaultValues },
  });
  return (
    <SqlVariablesProvider variables={[cloudVariable]}>
      <SqlQueryFilterEditForm
        control={control}
        setValue={setValue}
        otherFilters={[]}
      />
      <button type="button" onClick={handleSubmit(() => {})}>
        Save
      </button>
    </SqlVariablesProvider>
  );
}

const renderForm = async (sql = 'SELECT env FROM envs') => {
  renderWithMantine(<Harness />);
  const user = userEvent.setup();
  await user.type(screen.getByTestId('connection-input'), 'conn1');
  // `{` starts a user-event key descriptor, so it must be doubled.
  await user.type(screen.getByTestId('sql-input'), sql.replace(/{/g, '{{'));
  return user;
};

describe('SqlQueryFilterEditForm', () => {
  beforeEach(() => {
    mockSources = [];
    mockUseSqlQueryFilterValues.mockReset();
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: ['prod', 'dev'] }),
    );
  });

  it('suggests time macros but not source or interval macros', () => {
    renderWithMantine(<Harness />);

    expect(mockCompletionLabels).toContain('$__timeFilter');
    expect(
      mockCompletionLabels.filter(label =>
        /^\$__(sourceTable|filters|timeInterval|timeInterval_ms|interval_s)(\(|$)/.test(
          label,
        ),
      ),
    ).toEqual([]);
  });

  it('accepts a query that references a known variable', async () => {
    const user = await renderForm(
      'SELECT env FROM envs WHERE $__filter(cloud, $cloud)',
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByText(/unknown variable/)).not.toBeInTheDocument();
  });

  it.each([
    ['an unknown variable', 'SELECT env FROM envs WHERE $__filter(env, $own)'],
    ['a source macro', 'SELECT env FROM $__sourceTable'],
    ['an interval macro', 'SELECT $__interval_s FROM envs'],
  ])('rejects a query that uses %s', async (_, sql) => {
    const user = await renderForm(sql);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        /unknown variable|cannot be used|no source is selected/,
      ),
    ).toBeInTheDocument();
  });

  describe('with a source', () => {
    const renderWithSource = async (sql: string) => {
      mockSources = [logSource('logs', 'conn1'), logSource('other', 'conn2')];
      renderWithMantine(
        <Harness defaultValues={{ connection: 'conn1', source: 'logs' }} />,
      );
      const user = userEvent.setup();
      await user.type(screen.getByTestId('sql-input'), sql);
      return user;
    };

    it('suggests and accepts the source macros', async () => {
      const user = await renderWithSource(
        'SELECT ServiceName FROM $__sourceTable WHERE $__filters',
      );

      expect(mockCompletionLabels).toContain('$__sourceTable');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(
        screen.queryByText(/no source is selected|cannot be used/),
      ).not.toBeInTheDocument();
    });

    it('previews with the source', async () => {
      const user = await renderWithSource(
        'SELECT ServiceName FROM $__sourceTable',
      );

      await user.click(screen.getByTestId('filter-sql-preview-button'));

      expect(mockUseSqlQueryFilterValues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: [expect.objectContaining({ source: 'logs' })],
        }),
      );
    });

    it('clears the source when the connection changes to one it is not on', async () => {
      await renderWithSource('SELECT 1');

      fireEvent.change(screen.getByTestId('connection-input'), {
        target: { value: 'conn2' },
      });

      await waitFor(() =>
        expect(screen.getByTestId('source-input')).toHaveValue(''),
      );
    });

    it('clears a source of a kind the filter cannot use', async () => {
      mockSources = [
        {
          id: 'prom',
          name: 'prom',
          kind: SourceKind.Promql,
          connection: 'conn1',
          from: { databaseName: 'default', tableName: 'ts' },
          timestampValueExpression: 'Timestamp',
        },
      ];
      renderWithMantine(
        <Harness defaultValues={{ connection: 'conn1', source: 'prom' }} />,
      );

      await waitFor(() =>
        expect(screen.getByTestId('source-input')).toHaveValue(''),
      );
    });
  });

  it('shows the loader, not the last values, while a re-run fetches', async () => {
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: ['prod', 'dev'], isFetching: true }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview')).toHaveTextContent(
      'Running query',
    );
    expect(
      screen.queryByTestId('filter-sql-preview-values'),
    ).not.toBeInTheDocument();
  });

  it('disables the preview until there is a connection and a query', async () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('filter-sql-preview-button')).toBeDisabled();
  });

  it('previews the values the query returns', async () => {
    const user = await renderForm();

    expect(screen.queryByTestId('filter-sql-preview')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview')).toHaveTextContent(
      '2 values',
    );
    expect(screen.getByTestId('filter-sql-preview-values')).toHaveTextContent(
      /^prod, dev$/,
    );
    expect(mockUseSqlQueryFilterValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            connection: 'conn1',
            sqlTemplate: 'SELECT env FROM envs',
          }),
        ],
      }),
    );
  });

  it('lists the first twenty values and counts the rest', async () => {
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: Array.from({ length: 25 }, (_, i) => `v${i}`) }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    const list = screen.getByTestId('filter-sql-preview-values');
    expect(list).toHaveTextContent(/^v0, v1, .*, v19, and 5 more$/);
    expect(list).not.toHaveTextContent('v20');
  });

  it('truncates a long value and keeps it whole in its title', async () => {
    const long = 'eu-west-1-production-blue';
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: [long, 'exactly-twenty-chars'] }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview-values')).toHaveTextContent(
      'eu-west-1-production…, exactly-twenty-chars',
    );
    expect(screen.getByTitle(long)).toBeInTheDocument();
  });

  it("shows the query's error", async () => {
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ error: 'Unknown table default.envs' }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview')).toHaveTextContent(
      'Unknown table default.envs',
    );
  });
});
