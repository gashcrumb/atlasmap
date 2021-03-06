/*
    Copyright (C) 2017 Red Hat, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

            http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/
import { INamespace, NamespaceDialog } from '../../UI';
import React, { ReactElement, useCallback, useState } from 'react';

import { useToggle } from '../../Atlasmap/utils';

type NamespaceCallback = (namespace: INamespace) => void;

export function useNamespaceDialog(
  title: string,
): [ReactElement, (cb: NamespaceCallback, namespace?: INamespace) => void] {
  const [onNamespaceCb, setOnNamespaceCb] = useState<NamespaceCallback | null>(
    null,
  );
  const [initialNamespace, setInitialNamespace] = useState<INamespace | null>(
    null,
  );
  const { state, toggleOn, toggleOff } = useToggle(false);
  const onConfirm = useCallback(
    (namespace: INamespace) => {
      if (onNamespaceCb) {
        onNamespaceCb(namespace);
        toggleOff();
      }
    },
    [onNamespaceCb, toggleOff],
  );
  const dialog = (
    <NamespaceDialog
      title={title}
      isOpen={state}
      onCancel={toggleOff}
      onConfirm={onConfirm}
      {...(initialNamespace || {})}
    />
  );
  const onOpenNamespaceDialog = useCallback(
    (callback: NamespaceCallback, namespace?: INamespace) => {
      // we use a closure to set the state here else React will think that callback
      // is the function to retrieve the state and will call it immediately.
      setOnNamespaceCb(() => callback);
      if (namespace) {
        setInitialNamespace(namespace);
      }
      toggleOn();
    },
    [toggleOn],
  );
  return [dialog, onOpenNamespaceDialog];
}
