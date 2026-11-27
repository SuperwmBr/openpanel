import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { popModal } from '.';
import { ModalContent, ModalHeader } from './Modal/Container';
import { InputWithLabel } from '@/components/forms/input-with-label';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { useAppParams } from '@/hooks/use-app-params';
import { handleError, useTRPC } from '@/integrations/trpc/react';

const validator = z.object({
  name: z.string().min(1, 'Required'),
});

type IForm = z.infer<typeof validator>;

export interface AddDashboardProps {
  name?: string;
  template?: 'iprisk';
}

export default function AddDashboard({
  name,
  template,
}: AddDashboardProps = {}) {
  const { projectId, organizationId } = useAppParams();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState } = useForm<IForm>({
    resolver: zodResolver(validator),
    defaultValues: {
      name: name ?? (template === 'iprisk' ? 'IPRisk | Visitors' : ''),
    },
  });

  const mutation = useMutation(
    trpc.dashboard.create.mutationOptions({
      onSuccess(res) {
        router.navigate({
          to: '/$organizationId/$projectId/dashboards/$dashboardId',
          params: {
            organizationId,
            projectId,
            dashboardId: res.id,
          },
        });
        toast('Success', {
          description:
            template === 'iprisk'
              ? 'IPRisk dashboard created with visitor classification charts.'
              : 'Dashboard created.',
        });
        queryClient.invalidateQueries(trpc.dashboard.list.pathFilter());
        popModal();
      },
      onError: handleError,
    })
  );

  return (
    <ModalContent>
      <ModalHeader
        title={template === 'iprisk' ? 'Create IPRisk dashboard' : 'Add dashboard'}
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(({ name }) => {
          mutation.mutate({
            name,
            projectId,
            template,
          });
        })}
      >
        {template === 'iprisk' && (
          <p className="text-muted-foreground text-sm">
            Creates session charts for IPRisk classification, bot or crawler
            flags, fraud risk, and blocking recommendations.
          </p>
        )}
        <InputWithLabel
          label="Name"
          placeholder="Name of the dashboard"
          {...register('name')}
        />
        <DialogFooter>
          <Button onClick={() => popModal()} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={!formState.isDirty} type="submit">
            Create
          </Button>
        </DialogFooter>
      </form>
    </ModalContent>
  );
}
