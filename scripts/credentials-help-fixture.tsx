/**
 * Real-component fixture for the Coding Plan local-credentials help section.
 *
 * Mounts the actual Modal, Select, CodingPlanLocalCredentialsHelp and i18n
 * bootstrap inside a form, mirroring the account-modal integration. The form
 * content unmounts when the modal closes, exactly like the real account
 * modal. Driven only by scripts/smoke-credentials-help-fixture.py through
 * the Vite dev server; never imported by the application bundle.
 */
/* eslint-disable react-refresh/only-export-components -- dev-only fixture entry, never hot-reloaded */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n';
import { CodingPlanLocalCredentialsHelp } from '@/features/authFiles/components/CodingPlanLocalCredentialsHelp';
import { Modal } from '@/components/ui/Modal';

type FormSnapshot = { apiKey: string; submitCount: number };

type FixtureState = FormSnapshot & {
  modalOpen: boolean;
  formMounted: boolean;
  reopenCount: number;
};

declare global {
  interface Window {
    __credentialsHelpFixtureState: () => FixtureState;
  }
}

function AccountModalContent(props: {
  onClose: () => void;
  onSnapshot: (snapshot: FormSnapshot) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [submitCount, setSubmitCount] = useState(0);

  const { onSnapshot } = props;
  useEffect(() => {
    onSnapshot({ apiKey, submitCount });
  }, [onSnapshot, apiKey, submitCount]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitCount((n) => n + 1);
      }}
    >
      <Modal open title="Fixture account modal" onClose={props.onClose}>
        <input
          aria-label="API key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <CodingPlanLocalCredentialsHelp />
      </Modal>
    </form>
  );
}

function CredentialsHelpFixture() {
  const [modalOpen, setModalOpen] = useState(true);
  const [reopenCount, setReopenCount] = useState(0);
  const snapshotRef = useRef<FormSnapshot>({ apiKey: '', submitCount: 0 });
  const onSnapshot = useCallback((snapshot: FormSnapshot) => {
    snapshotRef.current = snapshot;
  }, []);

  useEffect(() => {
    window.__credentialsHelpFixtureState = () => ({
      ...snapshotRef.current,
      modalOpen,
      formMounted: modalOpen,
      reopenCount,
    });
  });

  return modalOpen ? (
    <AccountModalContent onClose={() => setModalOpen(false)} onSnapshot={onSnapshot} />
  ) : (
    <button type="button" onClick={() => { setModalOpen(true); setReopenCount((n) => n + 1); }}>
      Reopen modal
    </button>
  );
}

createRoot(document.getElementById('credentials-help-fixture-root') as HTMLElement).render(
  <CredentialsHelpFixture />,
);
