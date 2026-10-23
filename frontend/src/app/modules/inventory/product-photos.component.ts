import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { environment } from '../../../environments/environment';
import { preparePhoto } from './photo-prepare';

export interface ProductPhoto {
  id: number;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isPrimary: boolean;
}

interface PendingUpload {
  name: string;
  /** 0 to 100 while sending; null while the photo is being prepared. */
  progress: number | null;
  error: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

const MAX_PHOTOS = 12;

/**
 * The product's photos for the website: upload, choose the main photo, put
 * them in order, describe them, delete. Changes save as they are made.
 */
@Component({
  selector: 'app-product-photos',
  standalone: true,
  imports: [FormsModule],
  styles: [`:host { display: block; }`],
  template: `
    <section class="bg-surface-container rounded-xl p-6" aria-labelledby="photos-heading">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <h2 id="photos-heading" class="text-xl font-headline font-bold text-on-surface">Photos</h2>
        <span class="text-xs text-on-surface-variant tabular-nums">{{ photos.length }} of {{ maxPhotos }}</span>
      </div>
      <p class="text-sm text-on-surface-variant mb-5">
        Shown on the website in this order. The first photo is the main one, on the product card.
      </p>

      @if (loading) {
        <p class="text-sm text-on-surface-variant py-6">Loading photos…</p>
      } @else {
        <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          @for (photo of photos; track photo.id; let i = $index; let last = $last) {
            <li class="flex flex-col rounded-lg bg-surface-container-high overflow-hidden" [attr.data-testid]="'photo-' + photo.id">
              <div class="relative aspect-[3/4] bg-surface-container-highest">
                <img
                  [src]="photo.url"
                  [alt]="photo.alt || productName + ' photo ' + (i + 1)"
                  loading="lazy"
                  class="absolute inset-0 h-full w-full object-cover"
                />
                @if (photo.isPrimary) {
                  <span class="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-primary shadow">
                    Main photo
                  </span>
                }
              </div>

              @if (canEdit) {
                <div class="flex flex-col gap-2 p-2.5">
                  <input
                    type="text"
                    maxlength="200"
                    class="w-full rounded-md bg-surface-container px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 border border-outline-variant/20 focus:border-primary focus:outline-none"
                    placeholder="Describe it (e.g. back view)"
                    [attr.aria-label]="'Description for photo ' + (i + 1)"
                    [ngModel]="photo.alt ?? ''"
                    (ngModelChange)="draftAlt[photo.id] = $event"
                    (blur)="saveAlt(photo)"
                    (keydown.enter)="saveAlt(photo)"
                  />

                  @if (confirmingDelete === photo.id) {
                    <div class="flex items-center justify-between gap-2 rounded-md bg-error/10 px-2 py-1.5">
                      <span class="text-xs font-medium text-error">Delete this photo?</span>
                      <span class="flex gap-1">
                        <button type="button" class="rounded px-2 py-1 text-xs font-semibold text-error hover:bg-error/15 cursor-pointer" [disabled]="busy" (click)="remove(photo)">Delete</button>
                        <button type="button" class="rounded px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-highest cursor-pointer" (click)="confirmingDelete = null">Keep</button>
                      </span>
                    </div>
                  } @else {
                    <div class="flex items-center justify-between gap-1">
                      <span class="flex gap-0.5">
                        <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35 disabled:pointer-events-none cursor-pointer" [disabled]="busy || i === 0" (click)="move(i, -1)" [attr.aria-label]="'Move photo ' + (i + 1) + ' earlier'" title="Move earlier">
                          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
                        </button>
                        <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35 disabled:pointer-events-none cursor-pointer" [disabled]="busy || last" (click)="move(i, 1)" [attr.aria-label]="'Move photo ' + (i + 1) + ' later'" title="Move later">
                          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
                        </button>
                      </span>
                      <span class="flex gap-0.5">
                        @if (!photo.isPrimary) {
                          <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35 disabled:pointer-events-none cursor-pointer" [disabled]="busy" (click)="makePrimary(photo)" [attr.aria-label]="'Make photo ' + (i + 1) + ' the main photo'" title="Make main photo">
                            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">star</span>
                          </button>
                        }
                        <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-35 disabled:pointer-events-none cursor-pointer hover:text-error" [disabled]="busy" (click)="confirmingDelete = photo.id" [attr.aria-label]="'Delete photo ' + (i + 1)" title="Delete">
                          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                        </button>
                      </span>
                    </div>
                  }
                </div>
              } @else if (photo.alt) {
                <p class="px-2.5 py-2 text-xs text-on-surface-variant truncate">{{ photo.alt }}</p>
              }
            </li>
          }

          @for (u of uploads; track u) {
            <li class="flex flex-col rounded-lg bg-surface-container-high overflow-hidden">
              <div class="relative aspect-[3/4] flex flex-col items-center justify-center gap-2 p-3 text-center">
                @if (u.error) {
                  <span class="material-symbols-outlined text-error" aria-hidden="true">error</span>
                  <span class="text-xs text-error">{{ u.error }}</span>
                  <button type="button" class="text-xs text-on-surface-variant underline cursor-pointer" (click)="dismiss(u)">Dismiss</button>
                } @else {
                  <span class="text-xs text-on-surface-variant">{{ u.progress === null ? 'Preparing…' : 'Uploading ' + u.progress + '%' }}</span>
                  <span class="h-1 w-3/4 rounded-full bg-surface-container-highest overflow-hidden">
                    <span class="block h-full bg-primary transition-[width]" [style.width.%]="u.progress ?? 5"></span>
                  </span>
                }
                <span class="w-full truncate text-[11px] text-on-surface-variant/70">{{ u.name }}</span>
              </div>
            </li>
          }

          @if (canEdit && photos.length + activeUploads() < maxPhotos) {
            <li>
              <label
                class="flex aspect-[3/4] h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-center transition-colors"
                [class]="dragOver ? 'border-primary bg-primary/10' : 'border-outline-variant/30 hover:border-primary/60'"
                (dragover)="onDragOver($event)"
                (dragleave)="dragOver = false"
                (drop)="onDrop($event)"
              >
                <span class="material-symbols-outlined text-3xl text-primary" aria-hidden="true">add_photo_alternate</span>
                <span class="text-sm font-semibold text-on-surface">Add photos</span>
                <span class="text-[11px] text-on-surface-variant">Tap to choose or take a picture, or drop files here</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" multiple class="sr-only" data-testid="photo-input" (change)="onPick($event)" />
              </label>
            </li>
          }
        </ul>

        @if (!photos.length && !uploads.length && !canEdit) {
          <p class="text-sm text-on-surface-variant">No photos yet.</p>
        }
      }
    </section>
  `,
})
export class ProductPhotosComponent implements OnChanges {
  @Input({ required: true }) productId!: number;
  @Input() productName = 'Product';
  @Input() canEdit = false;

  readonly maxPhotos = MAX_PHOTOS;
  photos: ProductPhoto[] = [];
  uploads: PendingUpload[] = [];
  draftAlt: Record<number, string> = {};
  confirmingDelete: number | null = null;
  loading = true;
  busy = false;
  dragOver = false;

  private queue: File[] = [];
  private draining = false;

  constructor(
    private api: ApiService,
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['productId'] && this.productId) this.load();
  }

  private get base(): string {
    return `/products/${this.productId}/images`;
  }

  /** `quiet` refreshes in place, without swapping the grid for "Loading…". */
  load(quiet = false): void {
    if (!quiet) this.loading = true;
    this.api.get<ApiResponse<ProductPhoto[]>>(this.base).subscribe({
      next: (res) => {
        this.photos = res.data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Could not load the photos');
      },
    });
  }

  activeUploads(): number {
    return this.uploads.filter((u) => !u.error).length;
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.enqueue(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    this.enqueue(Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/')));
  }

  dismiss(u: PendingUpload): void {
    this.uploads = this.uploads.filter((x) => x !== u);
  }

  private enqueue(files: File[]): void {
    const room = MAX_PHOTOS - this.photos.length - this.activeUploads();
    if (files.length > room) {
      this.notify.error(room > 0 ? `Only ${room} more photo${room === 1 ? '' : 's'} can be added` : `A product can have ${MAX_PHOTOS} photos at most`);
    }
    this.queue.push(...files.slice(0, Math.max(0, room)));
    this.drain();
  }

  /** One at a time, so the order they were picked in is the order they land in. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) {
      const file = this.queue.shift()!;
      const pending: PendingUpload = { name: file.name, progress: null, error: null };
      this.uploads = [...this.uploads, pending];
      try {
        const prepared = await preparePhoto(file);
        const photo = await this.send(prepared.blob, file.name, pending);
        this.photos = [...this.photos, photo];
        this.dismiss(pending);
      } catch (err: any) {
        pending.error = err?.error?.error || err?.message || 'Upload failed';
        this.uploads = [...this.uploads];
      }
    }
    this.draining = false;
  }

  private send(blob: Blob, name: string, pending: PendingUpload): Promise<ProductPhoto> {
    const form = new FormData();
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    form.append('file', blob, `${name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`);
    return new Promise((resolve, reject) => {
      this.http
        .post<ApiResponse<ProductPhoto>>(`${environment.apiUrl}${this.base}`, form, { reportProgress: true, observe: 'events' })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              pending.progress = Math.round((100 * event.loaded) / event.total);
              this.uploads = [...this.uploads];
            } else if (event.type === HttpEventType.Response && event.body) {
              resolve(event.body.data);
            }
          },
          error: reject,
        });
    });
  }

  saveAlt(photo: ProductPhoto): void {
    const draft = this.draftAlt[photo.id];
    if (draft === undefined || draft.trim() === (photo.alt ?? '')) return;
    delete this.draftAlt[photo.id];
    this.api.patch<ApiResponse<ProductPhoto>>(`${this.base}/${photo.id}`, { alt: draft.trim() || null }).subscribe({
      next: (res) => this.replace(res.data),
      error: () => this.notify.error('Could not save the description'),
    });
  }

  makePrimary(photo: ProductPhoto): void {
    this.busy = true;
    this.api.patch<ApiResponse<ProductPhoto>>(`${this.base}/${photo.id}`, { isPrimary: true }).subscribe({
      // The main photo moves to the front, so take the new order from the server.
      next: () => {
        this.busy = false;
        this.load(true);
      },
      error: () => {
        this.busy = false;
        this.notify.error('Could not change the main photo');
      },
    });
  }

  move(index: number, by: -1 | 1): void {
    const swapped = [...this.photos];
    [swapped[index], swapped[index + by]] = [swapped[index + by], swapped[index]];
    const next = swapped.map((p, i) => ({ ...p, isPrimary: i === 0 }));
    const before = this.photos;
    this.photos = next;
    this.busy = true;
    this.api.put<ApiResponse<ProductPhoto[]>>(`${this.base}/order`, { ids: next.map((p) => p.id) }).subscribe({
      next: (res) => {
        this.photos = res.data;
        this.busy = false;
      },
      error: (err) => {
        this.photos = before;
        this.busy = false;
        this.notify.error(err?.error?.error || 'Could not reorder the photos');
        if (err?.status === 409) this.load(true);
      },
    });
  }

  remove(photo: ProductPhoto): void {
    this.busy = true;
    this.api.delete<ApiResponse<ProductPhoto[]>>(`${this.base}/${photo.id}`).subscribe({
      next: (res) => {
        this.photos = res.data;
        this.confirmingDelete = null;
        this.busy = false;
      },
      error: () => {
        this.busy = false;
        this.notify.error('Could not delete the photo');
      },
    });
  }

  private replace(updated: ProductPhoto): void {
    this.photos = this.photos.map((p) => (p.id === updated.id ? updated : p));
  }
}
