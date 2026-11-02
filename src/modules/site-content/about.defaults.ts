import type { AboutDocument } from "./about.validation";

/**
 * Starter content for a brand-new About page. It is a DRAFT scaffold for the admin to review and
 * rewrite; nothing is public until it is published. Wording is deliberately plain and makes no
 * promises about funding or travel.
 */
export const DEFAULT_ABOUT_DOCUMENT: AboutDocument = {
  blocks: [
    {
      id: "hero",
      type: "hero",
      tone: "surface",
      pill: "About Gaza1st",
      headline: "Helping students from Gaza reach higher education",
      subline: "We support Palestinian students from Gaza as they look for university places, funding and a safe route to study."
    },
    {
      id: "story",
      type: "richText",
      tone: "white",
      mediaSide: "end",
      title: "Our story",
      html: "<p>Replace this text with the story of Gaza1st: who we are, why we started and who we work with.</p>"
    },
    {
      id: "mission",
      type: "mission",
      tone: "primary",
      statement: "Every student from Gaza should have a fair chance to study, whatever their circumstances."
    },
    {
      id: "areas",
      type: "coreAreas",
      tone: "surface",
      title: "What we do",
      intro: "Four areas of work, from first application to life after arrival.",
      items: [
        {
          icon: "school",
          title: "Admissions",
          body: "We help students find and apply for suitable university opportunities in the UK, Ireland and Brazil."
        },
        {
          icon: "volunteer_activism",
          title: "Fundraising & Scholarships",
          body: "We help students tackle the cost of study, including a regularly updated database of available scholarships."
        },
        {
          icon: "flight_takeoff",
          title: "Evacuation & Safe Travel",
          body: "For students with a place and funding who cannot yet leave, we coordinate and advocate for safe departure and onward travel."
        },
        {
          icon: "diversity_3",
          title: "Post-Arrival Support",
          body: "Our responsibility does not end when a student leaves Gaza. Our teams help students settle in and succeed."
        }
      ]
    },
    {
      id: "notice",
      type: "notice",
      tone: "white",
      title: "What we can and cannot do",
      html:
        "<p>We provide an up-to-date scholarship database, but we are not able to commit funding to any student. We are actively looking for sponsors and solutions.</p>" +
        "<p>We do not guarantee evacuation. We advocate and liaise; final arrangements rest with the governments concerned, and timelines cannot be guaranteed.</p>"
    },
    {
      id: "impact",
      type: "impact",
      tone: "surface",
      title: "Our impact",
      intro: "Figures are updated as they change."
    },
    {
      id: "stories",
      type: "storiesPreview",
      tone: "white",
      title: "Student stories",
      limit: 3
    },
    {
      id: "cta",
      type: "cta",
      tone: "inverseSurface",
      title: "Get involved",
      body: "Whether you are a student, a volunteer or a supporter, we would like to hear from you.",
      buttonLabel: "Get in touch",
      buttonHref: "mailto:hello@example.org"
    }
  ]
};
