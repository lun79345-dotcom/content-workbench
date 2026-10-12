import { ActionForm } from "@/components/action-form";
import { decideReviewForm as decideReview } from "@/app/(main)/videos/actions";
import { Submit } from "@/components/submit";
import { REJECT_REASONS } from "@/lib/rules";

export function ReviewDecision({ reviewId }: { reviewId: number }) {
  return (
    <ActionForm action={decideReview} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
      <input type="hidden" name="review_id" value={reviewId} />
      <select name="reason" className="input" defaultValue="">
        <option value="">打回原因归类（通过时不填）</option>
        {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
      <input name="comment" className="input" placeholder="修改意见，如：字幕02:14「的」应为「得」" />
      <div className="flex gap-2">
        <Submit name="decision" value="pass" done={null} className="btn btn-primary">通过</Submit>
        <Submit name="decision" value="reject" done={null} className="btn btn-danger">打回</Submit>
      </div>
    </ActionForm>
  );
}
