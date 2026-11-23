import { useState, useEffect, useCallback } from 'react';
import { type BoardFilters } from '../utils/queryKeys';

interface EpicOption {
  id: string;
  title: string;
}

interface FilterBarProps {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  teamId: string;
  epics: Array<EpicOption>;
}

export default function FilterBar({
  filters,
  onChange,
  teamId,
  epics,
}: FilterBarProps): JSX.Element {
  const [qValue, setQValue] = useState(filters.q ?? '');

  useEffect(() => {
    setQValue(filters.q ?? '');
  }, [filters.q]);

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const type = e.target.value === 'all' ? undefined : e.target.value;
      onChange({ ...filters, type });
    },
    [filters, onChange],
  );

  const handleEpicChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const epic = e.target.value === 'all' ? undefined : e.target.value;
      onChange({ ...filters, epic });
    },
    [filters, onChange],
  );

  const handleQChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQValue(e.target.value);
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = qValue.trim() === '' ? undefined : qValue.trim();
      onChange({ ...filters, q });
    }, 300);
    return () => clearTimeout(timer);
  }, [qValue, filters, onChange]);

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <select
        value={filters.type ?? 'all'}
        onChange={handleTypeChange}
        className="border rounded px-2 py-1.5 text-sm border-gray-300 bg-white"
      >
        <option value="all">All types</option>
        <option value="bug">Bug</option>
        <option value="feature">Feature</option>
        <option value="fix">Fix</option>
      </select>

      <select
        value={filters.epic ?? 'all'}
        onChange={handleEpicChange}
        className="border rounded px-2 py-1.5 text-sm border-gray-300 bg-white"
        disabled={!teamId}
      >
        <option value="all">All epics</option>
        <option value="none">No epic</option>
        {epics.map((epic) => (
          <option key={epic.id} value={epic.id}>
            {epic.title}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Search titles..."
        value={qValue}
        onChange={handleQChange}
        className="border rounded px-2 py-1.5 text-sm border-gray-300 flex-1 min-w-[160px]"
      />
    </div>
  );
}
