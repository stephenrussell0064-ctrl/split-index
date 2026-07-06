"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SplitWeightSlider } from "@/components/dashboard/split-weight-slider";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Scale } from "lucide-react";

interface SplitIndexSettingsProps {
  initialEnduranceWeight: number;
  userId: string;
}

export function SplitIndexSettings({
  initialEnduranceWeight,
  userId,
}: SplitIndexSettingsProps) {
  const [enduranceWeight, setEnduranceWeight] = useState(initialEnduranceWeight);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const persist = useCallback(
    async (weight: number) => {
      setSaving(true);
      setSaved(false);
      const supabase = createClient();
      await supabase
        .from("profiles")
        .update({ split_endurance_weight: weight })
        .eq("user_id", userId);
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [userId]
  );

  const handleChange = useCallback(
    (weight: number) => {
      setEnduranceWeight(weight);
      void persist(weight);
    },
    [persist]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-accent" />
          <CardTitle>Split Index balance</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted mb-4">
          Choose how much cardio vs strength contributes to your composite Split
          Index. Default is 50/50.
        </p>
        <SplitWeightSlider
          enduranceWeight={enduranceWeight}
          onChange={handleChange}
          disabled={saving}
        />
        {saved && (
          <p className="mt-2 text-xs text-success text-center">Saved</p>
        )}
      </CardContent>
    </Card>
  );
}
