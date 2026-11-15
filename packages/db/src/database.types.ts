
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "attempts": {
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
    }
                  ]
                },"exercises": {
                  Row: {
                    "concept_id": string | null,"id": string,"is_active": boolean,"lesson_id": string,"payload": NonNullable<Json>,"points": number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_id"?: string | null,"id"?: string,"is_active"?: boolean,"lesson_id": string,"payload": NonNullable<Json>,"points"?: number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
                  }
                  Update: {
                    "concept_id"?: string | null,"id"?: string,"is_active"?: boolean,"lesson_id"?: string,"payload"?: NonNullable<Json>,"points"?: number,"sort_order"?: number,"type"?: Database["public"]['Enums']["exercise_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "exercises_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "concepts"
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
      referencedRelation: "v_my_lessons"
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
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_sessions": {
                  Row: {
                    "correct_count": number,"finished_at": string | null,"id": string,"idempotency_key": string,"lesson_id": string,"score": number | null,"started_at": string,"total_exercises": number,"user_id": string,"xp_awarded": number
                  }
                  ComputedFields: never
                  Insert: {
                    "correct_count"?: number,"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"lesson_id": string,"score"?: number | null,"started_at"?: string,"total_exercises"?: number,"user_id": string,"xp_awarded"?: number
                  }
                  Update: {
                    "correct_count"?: number,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"lesson_id"?: string,"score"?: number | null,"started_at"?: string,"total_exercises"?: number,"user_id"?: string,"xp_awarded"?: number
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
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"lessons": {
                  Row: {
                    "created_at": string,"icon": string | null,"id": string,"is_published": boolean,"kind": Database["public"]['Enums']["lesson_kind"],"pass_threshold": number,"prerequisite_lesson_id": string | null,"review_scope_unit_id": string | null,"slug": string,"sort_order": number,"title": string,"unit_id": string,"xp_reward": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"kind"?: Database["public"]['Enums']["lesson_kind"],"pass_threshold"?: number,"prerequisite_lesson_id"?: string | null,"review_scope_unit_id"?: string | null,"slug": string,"sort_order": number,"title": string,"unit_id": string,"xp_reward"?: number
                  }
                  Update: {
                    "created_at"?: string,"icon"?: string | null,"id"?: string,"is_published"?: boolean,"kind"?: Database["public"]['Enums']["lesson_kind"],"pass_threshold"?: number,"prerequisite_lesson_id"?: string | null,"review_scope_unit_id"?: string | null,"slug"?: string,"sort_order"?: number,"title"?: string,"unit_id"?: string,"xp_reward"?: number
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
      referencedRelation: "v_my_lessons"
      referencedColumns: ["id"]
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
                    "avatar_key": string | null,"created_at": string,"display_name": string,"id": string,"time_zone": string,"ui_lang": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_key"?: string | null,"created_at"?: string,"display_name": string,"id": string,"time_zone"?: string,"ui_lang"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_key"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"time_zone"?: string,"ui_lang"?: string,"updated_at"?: string
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
            "v_my_daily": {
                  Row: {
                    "answers": number | null,"correct": number | null,"day": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_my_lessons": {
                  Row: {
                    "best_score": number | null,"icon": string | null,"id": string,"is_unlocked": boolean | null,"kind": Database["public"]['Enums']["lesson_kind"],"prerequisite_lesson_id": string | null,"slug": string,"sort_order": number,"stars": number | null,"status": string | null,"title": string,"unit_id": string,"word_count": number | null,"xp_reward": number
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
                    "badges_earned": number | null,"best_streak": number | null,"lessons_done": number | null,"streak_days": number | null,"total_points": number | null,"user_id": string,"words_due": number | null,"words_mastered": number | null,"words_seen": number | null
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
            "award_badges":
{ Args: { "p_user": string }; Returns: (string)[]
                           },
"before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"bootstrap_admin":
{ Args: { "p_email": string }; Returns: boolean
                           },
"create_invite":
{ Args: { "p_course"?: string,"p_days"?: number,"p_display_name"?: string,"p_email"?: string,"p_max_uses"?: number,"p_role"?: string }; Returns: string
                           },
"exercise_allowed_in_lesson":
{ Args: { "p_exercise": string,"p_lesson": string }; Returns: boolean
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
{ Args: { "p_lesson": string }; Returns: {
              "concept_id": string,"id": string,"payload": Json,"points": number,"sort_order": number,"type": Database["public"]['Enums']["exercise_type"]
            }[]
                           },
"get_review_set":
{ Args: { "p_limit"?: number,"p_unit": string }; Returns: {
              "concept_id": string,"due_on": string,"lapses": number,"stability": number
            }[]
                           },
"invite_preview":
{ Args: { "p_ip"?: string,"p_token": string }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_lesson_unlocked":
{ Args: { "p_lesson": string,"p_user": string }; Returns: boolean
                           },
"lesson_exercise_count":
{ Args: { "p_lesson": string,"p_user": string }; Returns: number
                           },
"list_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "course_title": string,"created_at": string,"display_name": string,"email": string,"expires_at": string,"id": string,"max_uses": number,"revoked_at": string,"role": string,"status": string,"token_prefix": string,"used_count": number
            }[]
                           },
"normalize_answer":
{ Args: { "p": string }; Returns: string
                           },
"pick_review_exercises":
{ Args: { "p_lesson": string,"p_user": string }; Returns: {
              "concept_id": string,"exercise_id": string,"priority": number
            }[]
                           },
"review_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"revoke_invite":
{ Args: { "p_id": string }; Returns: undefined
                           },
"srs_apply":
{ Args: { "p_concept": string,"p_course": string,"p_grade": number,"p_time_zone"?: string,"p_user": string }; Returns: undefined
                           },
"start_lesson_session":
{ Args: { "p_idempotency_key": string,"p_lesson": string }; Returns: string
                           },
"submit_attempt":
{ Args: { "p_answer": Json,"p_exercise": string,"p_hint_used"?: boolean,"p_response_ms"?: number,"p_session": string }; Returns: Json
                           },
"validate_exercise_payload":
{ Args: { "p": Json,"t": Database["public"]['Enums']["exercise_type"] }; Returns: boolean
                           }
          }
          Enums: {
            "exercise_type": "translate_ab"|"translate_ba"|"fill_blank_choice"|"inflection"|"listening"|"match_pairs"|"sentence_order","lesson_kind": "standard"|"review"|"test","part_of_speech": "noun"|"verb"|"adjective"|"adverb"|"phrase"|"other","point_reason": "exercise_correct"|"lesson_completed"|"streak_day"|"badge"|"review_completed"|"manual","progress_status": "in_progress"|"completed"
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
            "exercise_type": ["translate_ab", "translate_ba", "fill_blank_choice", "inflection", "listening", "match_pairs", "sentence_order"],"lesson_kind": ["standard", "review", "test"],"part_of_speech": ["noun", "verb", "adjective", "adverb", "phrase", "other"],"point_reason": ["exercise_correct", "lesson_completed", "streak_day", "badge", "review_completed", "manual"],"progress_status": ["in_progress", "completed"]
          }
        }
} as const
