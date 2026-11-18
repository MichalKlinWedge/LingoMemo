
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"attempts": {
                  Row: {
                    "concept_id": string | null,"created_at": string,"exercise_id": string | null,"exercise_type": Database["public"]['Enums']["exercise_type"],"hint_used": boolean,"id": number,"is_correct": boolean,"near_miss": boolean,"raw_answer": NonNullable<Json>,"response_ms": number | null,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_id"?: string | null,"created_at"?: string,"exercise_id"?: string | null,"exercise_type": Database["public"]['Enums']["exercise_type"],"hint_used"?: boolean,"id"?: never,"is_correct": boolean,"near_miss"?: boolean,"raw_answer": NonNullable<Json>,"response_ms"?: number | null,"session_id": string,"user_id": string
                  }
                  Update: {
                    "concept_id"?: string | null,"created_at"?: string,"exercise_id"?: string | null,"exercise_type"?: Database["public"]['Enums']["exercise_type"],"hint_used"?: boolean,"id"?: never,"is_correct"?: boolean,"near_miss"?: boolean,"raw_answer"?: NonNullable<Json>,"response_ms"?: number | null,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempts_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attempts_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attempts_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "lesson_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"badges": {
                  Row: {
                    "code": string,"description": string,"icon": string | null,"is_active": boolean,"rule": NonNullable<Json>,"sort_order": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"description": string,"icon"?: string | null,"is_active"?: boolean,"rule": NonNullable<Json>,"sort_order"?: number,"title": string
                  }
                  Update: {
                    "code"?: string,"description"?: string,"icon"?: string | null,"is_active"?: boolean,"rule"?: NonNullable<Json>,"sort_order"?: number,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"concepts": {
                  Row: {
                    "course_id": string | null,"created_at": string,"id": string,"image_path": string | null,"key": string,"tags": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "course_id"?: string | null,"created_at"?: string,"id"?: string,"image_path"?: string | null,"key": string,"tags"?: (string)[]
                  }
                  Update: {
                    "course_id"?: string | null,"created_at"?: string,"id"?: string,"image_path"?: string | null,"key"?: string,"tags"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "concepts_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concepts_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_my_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "concepts_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_stats_courses"
      referencedColumns: ["course_id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "created_at": string,"description": string | null,"icon": string | null,"id": string,"is_published": boolean,"slug": string,"sort_order": number,"source_lang": string,"target_lang": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"slug": string,"sort_order"?: number,"source_lang": string,"target_lang": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"slug"?: string,"sort_order"?: number,"source_lang"?: string,"target_lang"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courses_source_lang_fkey"
      columns: ["source_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "courses_target_lang_fkey"
      columns: ["target_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "course_id": string,"id": string,"started_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "course_id": string,"id"?: string,"started_at"?: string,"user_id": string
                  }
                  Update: {
                    "course_id"?: string,"id"?: string,"started_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_my_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "enrollments_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_stats_courses"
      referencedColumns: ["course_id"]
    }
                  ]
                },"exercises": {
                  Row: {
                    "concept_id": string | null,"easy_for": string | null,"id": string,"is_active": boolean,"lesson_id": string,"level": number | null,"payload": NonNullable<Json>,"points": number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_id"?: string | null,"easy_for"?: string | null,"id"?: string,"is_active"?: boolean,"lesson_id": string,"level"?: number | null,"payload": NonNullable<Json>,"points"?: number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
                  }
                  Update: {
                    "concept_id"?: string | null,"easy_for"?: string | null,"id"?: string,"is_active"?: boolean,"lesson_id"?: string,"level"?: number | null,"payload"?: NonNullable<Json>,"points"?: number,"sort_order"?: number,"type"?: Database["public"]['Enums']["exercise_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "exercises_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exercises_easy_for_fkey"
      columns: ["easy_for"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exercises_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exercises_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "exercises_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"hint_uses": {
                  Row: {
                    "created_at": string,"easier_id": string | null,"exercise_id": string | null,"id": string,"session_id": string | null,"used_on": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"easier_id"?: string | null,"exercise_id"?: string | null,"id"?: string,"session_id"?: string | null,"used_on": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"easier_id"?: string | null,"exercise_id"?: string | null,"id"?: string,"session_id"?: string | null,"used_on"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hint_uses_easier_id_fkey"
      columns: ["easier_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hint_uses_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hint_uses_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "lesson_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"languages": {
                  Row: {
                    "code": string,"is_active": boolean,"name_native": string,"name_pl": string,"tts_lang": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"is_active"?: boolean,"name_native": string,"name_pl": string,"tts_lang"?: string | null
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"name_native"?: string,"name_pl"?: string,"tts_lang"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"lesson_items": {
                  Row: {
                    "concept_id": string,"lesson_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_id": string,"lesson_id": string,"sort_order": number
                  }
                  Update: {
                    "concept_id"?: string,"lesson_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_items_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_items_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_items_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_items_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_level_progress": {
                  Row: {
                    "attempts_count": number,"best_score": number,"completed_at": string | null,"last_score": number | null,"lesson_id": string,"level": number,"stars": number,"status": Database["public"]['Enums']["progress_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id": string,"level": number,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id"?: string,"level"?: number,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_level_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_level_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_level_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_progress": {
                  Row: {
                    "attempts_count": number,"best_score": number,"completed_at": string | null,"last_score": number | null,"lesson_id": string,"stars": number,"status": Database["public"]['Enums']["progress_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id": string,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id"?: string,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_sessions": {
                  Row: {
                    "correct_count": number,"exercise_ids": (string)[],"finished_at": string | null,"id": string,"idempotency_key": string,"lesson_id": string,"level": number,"retried_exercise_ids": (string)[],"score": number | null,"stage_nr": number,"started_at": string,"total_exercises": number,"user_id": string,"xp_awarded": number
                  }
                  ComputedFields: never
                  Insert: {
                    "correct_count"?: number,"exercise_ids"?: (string)[],"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"lesson_id": string,"level"?: number,"retried_exercise_ids"?: (string)[],"score"?: number | null,"stage_nr"?: number,"started_at"?: string,"total_exercises"?: number,"user_id": string,"xp_awarded"?: number
                  }
                  Update: {
                    "correct_count"?: number,"exercise_ids"?: (string)[],"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"lesson_id"?: string,"level"?: number,"retried_exercise_ids"?: (string)[],"score"?: number | null,"stage_nr"?: number,"started_at"?: string,"total_exercises"?: number,"user_id"?: string,"xp_awarded"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_sessions_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_sessions_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_sessions_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_stage_progress": {
                  Row: {
                    "attempts_count": number,"best_score": number,"completed_at": string | null,"last_score": number | null,"lesson_id": string,"stage_nr": number,"stars": number,"status": Database["public"]['Enums']["progress_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id": string,"stage_nr": number,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "attempts_count"?: number,"best_score"?: number,"completed_at"?: string | null,"last_score"?: number | null,"lesson_id"?: string,"stage_nr"?: number,"stars"?: number,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_stage_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_stage_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_stage_progress_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_unlocks": {
                  Row: {
                    "created_at": string,"lesson_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"lesson_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"lesson_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_unlocks_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_unlocks_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lesson_unlocks_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lessons": {
                  Row: {
                    "created_at": string,"icon": string | null,"id": string,"is_published": boolean,"kind": Database["public"]['Enums']["lesson_kind"],"pass_threshold": number,"prerequisite_lesson_id": string | null,"review_scope_course_id": string | null,"review_scope_unit_id": string | null,"slug": string,"sort_order": number,"title": string,"unit_id": string,"xp_reward": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"kind"?: Database["public"]['Enums']["lesson_kind"],"pass_threshold"?: number,"prerequisite_lesson_id"?: string | null,"review_scope_course_id"?: string | null,"review_scope_unit_id"?: string | null,"slug": string,"sort_order": number,"title": string,"unit_id": string,"xp_reward"?: number
                  }
                  Update: {
                    "created_at"?: string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"kind"?: Database["public"]['Enums']["lesson_kind"],"pass_threshold"?: number,"prerequisite_lesson_id"?: string | null,"review_scope_course_id"?: string | null,"review_scope_unit_id"?: string | null,"slug"?: string,"sort_order"?: number,"title"?: string,"unit_id"?: string,"xp_reward"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_review_scope_course_id_fkey"
      columns: ["review_scope_course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_review_scope_course_id_fkey"
      columns: ["review_scope_course_id"]
isOneToOne: false
      referencedRelation: "v_my_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "lessons_review_scope_course_id_fkey"
      columns: ["review_scope_course_id"]
isOneToOne: false
      referencedRelation: "v_stats_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "lessons_review_scope_unit_id_fkey"
      columns: ["review_scope_unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_unit_id_fkey"
      columns: ["unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["id"]
    }
                  ]
                },"points_ledger": {
                  Row: {
                    "created_at": string,"delta": number,"id": number,"reason": Database["public"]['Enums']["point_reason"],"ref_id": string | null,"ref_type": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delta": number,"id"?: never,"reason": Database["public"]['Enums']["point_reason"],"ref_id"?: string | null,"ref_type"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"delta"?: number,"id"?: never,"reason"?: Database["public"]['Enums']["point_reason"],"ref_id"?: string | null,"ref_type"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_key": string | null,"created_at": string,"display_name": string,"id": string,"level": number,"time_zone": string,"ui_lang": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_key"?: string | null,"created_at"?: string,"display_name": string,"id": string,"level"?: number,"time_zone"?: string,"ui_lang"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_key"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"level"?: number,"time_zone"?: string,"ui_lang"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_ui_lang_fkey"
      columns: ["ui_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"srs_params": {
                  Row: {
                    "desired_retention": number,"enable_short_term": boolean,"id": number,"updated_at": string,"weights": (number)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "desired_retention"?: number,"enable_short_term"?: boolean,"id"?: number,"updated_at"?: string,"weights": (number)[]
                  }
                  Update: {
                    "desired_retention"?: number,"enable_short_term"?: boolean,"id"?: number,"updated_at"?: string,"weights"?: (number)[]
                  }
                  Relationships: [
                    
                  ]
                },"srs_state": {
                  Row: {
                    "concept_id": string,"course_id": string,"difficulty": number,"due_on": string,"lapses": number,"last_result": boolean | null,"last_reviewed_at": string | null,"reps": number,"stability": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_id": string,"course_id": string,"difficulty"?: number,"due_on"?: string,"lapses"?: number,"last_result"?: boolean | null,"last_reviewed_at"?: string | null,"reps"?: number,"stability"?: number,"user_id": string
                  }
                  Update: {
                    "concept_id"?: string,"course_id"?: string,"difficulty"?: number,"due_on"?: string,"lapses"?: number,"last_result"?: boolean | null,"last_reviewed_at"?: string | null,"reps"?: number,"stability"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "srs_state_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "srs_state_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "srs_state_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_my_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "srs_state_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_stats_courses"
      referencedColumns: ["course_id"]
    }
                  ]
                },"term_forms": {
                  Row: {
                    "form_label": string,"id": string,"normalized": string | null,"term_id": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "form_label": string,"id"?: string,"normalized"?: never,"term_id": string,"text": string
                  }
                  Update: {
                    "form_label"?: string,"id"?: string,"normalized"?: never,"term_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "term_forms_term_id_fkey"
      columns: ["term_id"]
isOneToOne: false
      referencedRelation: "terms"
      referencedColumns: ["id"]
    }
                  ]
                },"terms": {
                  Row: {
                    "article": string | null,"audio_path": string | null,"concept_id": string,"gender": string | null,"id": string,"ipa": string | null,"is_primary": boolean,"lang": string,"normalized": string | null,"note": string | null,"pos": Database["public"]['Enums']["part_of_speech"] | null,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "article"?: string | null,"audio_path"?: string | null,"concept_id": string,"gender"?: string | null,"id"?: string,"ipa"?: string | null,"is_primary"?: boolean,"lang": string,"normalized"?: never,"note"?: string | null,"pos"?: Database["public"]['Enums']["part_of_speech"] | null,"text": string
                  }
                  Update: {
                    "article"?: string | null,"audio_path"?: string | null,"concept_id"?: string,"gender"?: string | null,"id"?: string,"ipa"?: string | null,"is_primary"?: boolean,"lang"?: string,"normalized"?: never,"note"?: string | null,"pos"?: Database["public"]['Enums']["part_of_speech"] | null,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "terms_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "terms_lang_fkey"
      columns: ["lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"units": {
                  Row: {
                    "color": string | null,"course_id": string,"icon": string | null,"id": string,"is_published": boolean,"slug": string,"sort_order": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"course_id": string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"slug": string,"sort_order": number,"title": string
                  }
                  Update: {
                    "color"?: string | null,"course_id"?: string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"slug"?: string,"sort_order"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "units_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "units_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_my_courses"
      referencedColumns: ["course_id"]
    },{
      foreignKeyName: "units_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "v_stats_courses"
      referencedColumns: ["course_id"]
    }
                  ]
                },"user_badges": {
                  Row: {
                    "awarded_at": string,"badge_code": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "awarded_at"?: string,"badge_code": string,"user_id": string
                  }
                  Update: {
                    "awarded_at"?: string,"badge_code"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_badges_badge_code_fkey"
      columns: ["badge_code"]
isOneToOne: false
      referencedRelation: "badges"
      referencedColumns: ["code"]
    }
                  ]
                },"user_stats": {
                  Row: {
                    "best_streak": number,"last_active_on": string | null,"lessons_done": number,"streak_days": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "best_streak"?: number,"last_active_on"?: string | null,"lessons_done"?: number,"streak_days"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "best_streak"?: number,"last_active_on"?: string | null,"lessons_done"?: number,"streak_days"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "v_my_courses": {
                  Row: {
                    "course_icon": string | null,"course_id": string,"course_slug": string,"course_target_lang": string,"course_title": string,"enrolled_at": string,"lessons_done": number | null,"lessons_total": number | null,"seconds_total": number | null,"user_id": string,"words_due": number | null,"words_mastered": number | null,"words_seen": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "courses_target_lang_fkey"
      columns: ["course_target_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"v_my_daily": {
                  Row: {
                    "answers": number | null,"correct": number | null,"day": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_my_lesson_levels": {
                  Row: {
                    "exercise_count": number | null,"is_unlocked": boolean | null,"lesson_id": string,"level": number | null,"stars": number | null,"status": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_my_lessons": {
                  Row: {
                    "best_score": number | null,"icon": string | null,"id": string,"is_unlockable": boolean | null,"is_unlocked": boolean | null,"kind": Database["public"]['Enums']["lesson_kind"],"prerequisite_lesson_id": string | null,"slug": string,"sort_order": number,"stage_count": number | null,"stages_done": number | null,"stars": number | null,"status": string | null,"title": string,"unit_id": string,"word_count": number | null,"xp_reward": number
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lesson_levels"
      referencedColumns: ["lesson_id"]
    },{
      foreignKeyName: "lessons_prerequisite_lesson_id_fkey"
      columns: ["prerequisite_lesson_id"]
isOneToOne: false
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_unit_id_fkey"
      columns: ["unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["id"]
    }
                  ]
                },"v_my_stats": {
                  Row: {
                    "answers_correct": number | null,"answers_total": number | null,"badges_earned": number | null,"best_streak": number | null,"first_active_on": string | null,"last_active_on": string | null,"lessons_done": number | null,"seconds_total": number | null,"seconds_week": number | null,"sessions_done": number | null,"streak_days": number | null,"total_points": number | null,"user_id": string,"words_due": number | null,"words_mastered": number | null,"words_seen": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_my_weak_words": {
                  Row: {
                    "concept_id": string,"due_on": string,"lapses": number,"source_text": string | null,"stability": number,"target_text": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "concept_id"?: string | null,"due_on"?: string | null,"lapses"?: number | null,"source_text"?: never,"stability"?: number | null,"target_text"?: never,"user_id"?: string | null
                         }
                        Update: {
                           "concept_id"?: string | null,"due_on"?: string | null,"lapses"?: number | null,"source_text"?: never,"stability"?: number | null,"target_text"?: never,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "srs_state_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    }
                  ]
                },"v_stats_courses": {
                  Row: {
                    "course_id": string,"course_title": string,"learners": number | null,"lessons_done": number | null,"lessons_total": number | null,"target_lang": string,"words": number | null,"words_mastered": number | null,"words_started": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "course_id"?: string | null,"course_title"?: string | null,"learners"?: never,"lessons_done"?: never,"lessons_total"?: never,"target_lang"?: string | null,"words"?: never,"words_mastered"?: never,"words_started"?: never
                         }
                        Update: {
                           "course_id"?: string | null,"course_title"?: string | null,"learners"?: never,"lessons_done"?: never,"lessons_total"?: never,"target_lang"?: string | null,"words"?: never,"words_mastered"?: never,"words_started"?: never
                         }
                        Relationships: [
                    {
      foreignKeyName: "courses_target_lang_fkey"
      columns: ["target_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"v_stats_daily": {
                  Row: {
                    "answers": number | null,"correct": number | null,"day": string | null,"learners": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_stats_exercise_types": {
                  Row: {
                    "answers": number | null,"correct": number | null,"exercise_type": Database["public"]['Enums']["exercise_type"]
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_stats_hard_words": {
                  Row: {
                    "concept_id": string,"course_title": string | null,"lapses": number | null,"learners": number | null,"source_text": string | null,"target_text": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "srs_state_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    }
                  ]
                },"v_stats_summary": {
                  Row: {
                    "answers": number | null,"answers_correct": number | null,"learners": number | null,"learners_7d": number | null,"lessons_done": number | null,"seconds_total": number | null,"words_due": number | null,"words_mastered": number | null,"words_seen": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_user_points": {
                  Row: {
                    "total_points": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "admin_add_sentence_order":
{ Args: { "p_lesson": string }; Returns: number
                           },
"admin_add_word":
{ Args: { "p_key": string,"p_lesson": string,"p_source": string,"p_tags"?: (string)[],"p_target": string }; Returns: Json
                           },
"admin_course_requests":
{ Args: Record<PropertyKey, never>; Returns: {
              "course_id": string,"display_name": string,"first_at": string,"user_id": string
            }[]
                           },
"admin_delete_course":
{ Args: { "p_course": string }; Returns: Json
                           },
"admin_import_lesson":
{ Args: { "p_payload": Json }; Returns: Json
                           },
"admin_parents":
{ Args: Record<PropertyKey, never>; Returns: {
              "children": (string)[],"requested_at": string,"user_id": string
            }[]
                           },
"admin_remove_word":
{ Args: { "p_concept": string,"p_lesson": string }; Returns: Json
                           },
"admin_reorder_lessons":
{ Args: { "p_ids": (string)[],"p_unit": string }; Returns: Json
                           },
"admin_reorder_units":
{ Args: { "p_course": string,"p_ids": (string)[] }; Returns: Json
                           },
"admin_reset_hints":
{ Args: { "p_user": string }; Returns: number
                           },
"admin_set_child":
{ Args: { "p_child": string,"p_linked": boolean,"p_parent": string }; Returns: undefined
                           },
"admin_set_concept_image":
{ Args: { "p_concept": string,"p_path": string }; Returns: Json
                           },
"admin_set_parent":
{ Args: { "p_is_parent": boolean,"p_user": string }; Returns: undefined
                           },
"admin_set_setting":
{ Args: { "p_key": string,"p_value": Json }; Returns: Json
                           },
"admin_update_profile":
{ Args: { "p_display_name": string,"p_time_zone"?: string,"p_user": string }; Returns: undefined
                           },
"admin_update_word":
{ Args: { "p_concept": string,"p_source": string,"p_tags"?: (string)[],"p_target": string }; Returns: Json
                           },
"award_badges":
{ Args: { "p_user": string }; Returns: (string)[]
                           },
"bare_token":
{ Args: { "p_token": string }; Returns: string
                           },
"before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"bootstrap_admin":
{ Args: { "p_email": string }; Returns: boolean
                           },
"build_easy_variants":
{ Args: { "p_lesson": string }; Returns: number
                           },
"build_hard_variants":
{ Args: { "p_lesson": string }; Returns: number
                           },
"build_medium_variants":
{ Args: { "p_lesson": string }; Returns: number
                           },
"build_sentence_order":
{ Args: { "p_lesson": string }; Returns: number
                           },
"bump_streak":
{ Args: { "p_lesson_done": boolean,"p_today": string,"p_user": string }; Returns: number
                           },
"can_unlock_lesson":
{ Args: { "p_lesson": string,"p_user": string }; Returns: boolean
                           },
"child_exercise":
{ Args: { "p_exercise": string }; Returns: Json
                           },
"child_lessons":
{ Args: { "p_child": string }; Returns: {
              "best_score": number,"course_id": string,"icon": string,"is_unlocked": boolean,"kind": Database["public"]['Enums']["lesson_kind"],"lesson_id": string,"slug": string,"sort_order": number,"stage_count": number,"stages_done": number,"stars": number,"status": string,"title": string,"unit_id": string,"word_count": number
            }[]
                           },
"course_due_words":
{ Args: { "p_course": string,"p_user": string }; Returns: number
                           },
"course_started":
{ Args: { "p_course": string }; Returns: boolean
                           },
"create_invite":
{ Args: { "p_course"?: string,"p_days"?: number,"p_display_name"?: string,"p_email"?: string,"p_max_uses"?: number,"p_role"?: string }; Returns: string
                           },
"default_exercise_level":
{ Args: { "p": Json,"t": Database["public"]['Enums']["exercise_type"] }; Returns: number
                           },
"easier_exercise":
{ Args: { "p_exercise": string }; Returns: string
                           },
"exercise_allowed_in_lesson":
{ Args: { "p_exercise": string,"p_lesson": string }; Returns: boolean
                           },
"exercise_order":
{ Args: { "p_exercise": string }; Returns: number
                           },
"exercise_stage":
{ Args: { "p_exercise": string,"p_lesson": string }; Returns: number
                           },
"finish_lesson_session":
{ Args: { "p_session": string }; Returns: Json
                           },
"fsrs_clamp":
{ Args: { "hi": number,"lo": number,"v": number }; Returns: number
                           },
"fsrs_decay":
{ Args: { "w": (number)[] }; Returns: number
                           },
"fsrs_factor":
{ Args: { "w": (number)[] }; Returns: number
                           },
"fsrs_init_difficulty":
{ Args: { "g": number,"w": (number)[] }; Returns: number
                           },
"fsrs_init_stability":
{ Args: { "g": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_difficulty":
{ Args: { "d": number,"g": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_forget_stability":
{ Args: { "d": number,"r": number,"s": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_interval":
{ Args: { "desired_retention": number,"stability": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_recall_stability":
{ Args: { "d": number,"g": number,"r": number,"s": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_short_term_stability":
{ Args: { "g": number,"s": number,"w": (number)[] }; Returns: number
                           },
"fsrs_next_state":
{ Args: { "d": number,"elapsed_days": number,"enable_short_term"?: boolean,"g": number,"s": number,"w": (number)[] }; Returns: Database["public"]['CompositeTypes']["fsrs_state"]
                          SetofOptions: {
        from: "*"
        to: "fsrs_state"
        isOneToOne: true
        isSetofReturn: false
      } },
"fsrs_retrievability":
{ Args: { "elapsed_days": number,"stability": number,"w": (number)[] }; Returns: number
                           },
"fsrs_round":
{ Args: { "d"?: number,"v": number }; Returns: number
                           },
"fsrs_s_max":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"fsrs_s_min":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"get_lesson_exercises":
{ Args: { "p_lesson": string,"p_level"?: number,"p_preview"?: boolean,"p_stage"?: number }; Returns: {
              "concept_id": string,"id": string,"payload": Json,"points": number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
            }[]
                           },
"get_review_set":
{ Args: { "p_limit"?: number,"p_unit": string }; Returns: {
              "concept_id": string,"due_on": string,"lapses": number,"stability": number
            }[]
                           },
"hint_bonus":
{ Args: { "p_user": string }; Returns: number
                           },
"hint_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"hint_status":
{ Args: { "p_user": string }; Returns: Json
                           },
"hints_left":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"invite_preview":
{ Args: { "p_ip"?: string,"p_token": string }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_enrolled":
{ Args: { "p_course": string,"p_user": string }; Returns: boolean
                           },
"is_lesson_unlocked":
{ Args: { "p_lesson": string,"p_user": string }; Returns: boolean
                           },
"is_level_unlocked":
{ Args: { "p_lesson": string,"p_level": number,"p_user": string }; Returns: boolean
                           },
"is_parent":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_unit_unlocked":
{ Args: { "p_unit": string,"p_user": string }; Returns: boolean
                           },
"learner_today":
{ Args: { "p_user": string }; Returns: string
                           },
"lesson_exercise_count":
{ Args: { "p_lesson": string,"p_user": string }; Returns: number
                           },
"lesson_exercises_at_level":
{ Args: { "p_lesson": string,"p_level": number }; Returns: {
              "exercise_id": string
            }[]
                           },
"lesson_stage_count":
{ Args: { "p_lesson": string,"p_user": string }; Returns: number
                           },
"level_exercise_count":
{ Args: { "p_lesson": string,"p_level": number }; Returns: number
                           },
"level_run_size":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"list_accounts":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"display_name": string,"email": string,"is_admin": boolean,"last_sign_in_at": string,"password_changed_at": string,"user_id": string
            }[]
                           },
"list_courses_started":
{ Args: Record<PropertyKey, never>; Returns: {
              "course_id": string,"started": boolean
            }[]
                           },
"list_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "course_title": string,"created_at": string,"display_name": string,"email": string,"expires_at": string,"id": string,"max_uses": number,"revoked_at": string,"role": string,"status": string,"token_prefix": string,"used_count": number
            }[]
                           },
"list_students":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"display_name": string,"email": string,"is_admin": boolean,"last_active_on": string,"lessons_done": number,"level": number,"streak_days": number,"total_points": number,"user_id": string,"words_seen": number
            }[]
                           },
"media_usage":
{ Args: { "p_paths": (string)[] }; Returns: {
              "concepts": number,"exercises": number,"path": string
            }[]
                           },
"my_child_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_children":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"user_id": string
            }[]
                           },
"my_course_requests":
{ Args: Record<PropertyKey, never>; Returns: {
              "course_id": string,"first_at": string
            }[]
                           },
"normalize_answer":
{ Args: { "p": string }; Returns: string
                           },
"pick_level_exercises":
{ Args: { "p_lesson": string,"p_level": number }; Returns: {
              "exercise_id": string,"priority": number
            }[]
                           },
"pick_review_exercises":
{ Args: { "p_lesson": string,"p_user": string }; Returns: {
              "concept_id": string,"exercise_id": string,"priority": number
            }[]
                           },
"pick_test_exercises":
{ Args: { "p_lesson": string,"p_user": string }; Returns: {
              "concept_id": string,"exercise_id": string,"priority": number
            }[]
                           },
"pick_unit_exercises":
{ Args: { "p_unit": string }; Returns: {
              "concept_id": string,"exercise_id": string,"priority": number
            }[]
                           },
"request_child_access":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"request_course_access":
{ Args: { "p_course": string }; Returns: undefined
                           },
"review_gate":
{ Args: { "p_course": string,"p_user"?: string }; Returns: Json
                           },
"review_gate_lesson":
{ Args: { "p_course": string }; Returns: string
                           },
"review_gate_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"review_gate_on":
{ Args: { "p_course": string,"p_user": string }; Returns: boolean
                           },
"review_gate_passed_today":
{ Args: { "p_course": string,"p_user": string }; Returns: boolean
                           },
"review_gate_tried_today":
{ Args: { "p_course": string,"p_user": string }; Returns: boolean
                           },
"review_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"revoke_invite":
{ Args: { "p_id": string }; Returns: undefined
                           },
"same_letters":
{ Args: { "a": string,"b": string }; Returns: boolean
                           },
"sentence_distractors":
{ Args: { "p_lang": string,"p_unit": string,"p_words": (string)[] }; Returns: (string)[]
                           },
"session_seconds":
{ Args: { "p_finished": string,"p_started": string }; Returns: number
                           },
"set_learner_level":
{ Args: { "p_level": number,"p_user": string }; Returns: undefined
                           },
"set_user_password":
{ Args: { "p_password": string,"p_user": string }; Returns: undefined
                           },
"setting_int":
{ Args: { "p_default": number,"p_key": string }; Returns: number
                           },
"simpler_payload":
{ Args: { "p_exercise": string }; Returns: Json
                           },
"split_answers":
{ Args: { "p": string }; Returns: (string)[]
                           },
"srs_apply":
{ Args: { "p_concept": string,"p_course": string,"p_grade": number,"p_time_zone"?: string,"p_user": string }; Returns: undefined
                           },
"stage_size":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"start_lesson_session":
{ Args: { "p_idempotency_key": string,"p_lesson": string,"p_level"?: number,"p_preview"?: boolean,"p_stage"?: number }; Returns: string
                           },
"submit_attempt":
{ Args: { "p_answer": Json,"p_exercise": string,"p_hint_used"?: boolean,"p_response_ms"?: number,"p_session": string }; Returns: Json
                           },
"test_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"unit_practice_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"unlock_lesson":
{ Args: { "p_lesson": string }; Returns: Json
                           },
"unlock_points_earned":
{ Args: { "p_user": string }; Returns: number
                           },
"unlock_points_left":
{ Args: { "p_user": string }; Returns: number
                           },
"unlock_status":
{ Args: { "p_user": string }; Returns: Json
                           },
"use_hint":
{ Args: { "p_exercise": string,"p_session": string }; Returns: Json
                           },
"validate_exercise_payload":
{ Args: { "p": Json,"t": Database["public"]['Enums']["exercise_type"] }; Returns: boolean
                           },
"variant_pick":
{ Args: { "p_exercise": string }; Returns: string
                           }
          }
          Enums: {
            "exercise_type": "translate_ab"|"translate_ba"|"fill_blank_choice"|"inflection"|"listening"|"match_pairs"|"sentence_order"|"listen_match"|"image_choice","lesson_kind": "standard"|"review"|"test","part_of_speech": "noun"|"verb"|"adjective"|"adverb"|"phrase"|"other","point_reason": "exercise_correct"|"lesson_completed"|"streak_day"|"badge"|"review_completed"|"manual","progress_status": "in_progress"|"completed"
          }
          CompositeTypes: {
            "fsrs_state": {
                        "difficulty": number | null,"stability": number | null
                      }
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "exercise_type": ["translate_ab", "translate_ba", "fill_blank_choice", "inflection", "listening", "match_pairs", "sentence_order", "listen_match", "image_choice"],"lesson_kind": ["standard", "review", "test"],"part_of_speech": ["noun", "verb", "adjective", "adverb", "phrase", "other"],"point_reason": ["exercise_correct", "lesson_completed", "streak_day", "badge", "review_completed", "manual"],"progress_status": ["in_progress", "completed"]
          }
        }
} as const
