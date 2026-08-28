import { NextRequest } from 'next/server';
import { processLeadContent } from '@/lib/processLead';
import { createLead } from '@/lib/db/operations/create';
import { enrichLead } from '@/lib/enrichment/enrichLead';
import { Lead } from '@/lib/db/models/Lead';
import { jsonOk } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const rawContent = `[Home](https://www.linkedin.com/sales/home?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D)
[Accounts](https://www.linkedin.com/sales/accounts/dashboard?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D)
[Leads](https://www.linkedin.com/sales/lists/people?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D)
[Smart Links](https://www.linkedin.com/sales/smart-links?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D)
[Messaging](https://www.linkedin.com/sales/inbox?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D&trk=d_sales2_app_header_inbox)
Actions List
Referrals
77 new notifications
Abdul Rafay Full Stack AI Developer
Search
Search
[Lead filters](https://www.linkedin.com/sales/search/people?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D&viewAllFilters=true)
[Account filters](https://www.linkedin.com/sales/search/company?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D&viewAllFilters=true)
Saved searchesPersonas
Sales Navigator Lead Page
Basic lead information for Harley T.
Harley T.
3rdViewed: 8/28/2026
CTO at Trust Provenance
Adelaide, South Australia, Australia
289 connections
Save
Message
Current role
Chief Technology Officer at [Trust Provenance](https://www.linkedin.com/sales/company/18855440)
May 2021–Present 5 yrs 4 mos
No job description
Also worked at [Boeing](https://www.linkedin.com/sales/company/1384) See more
Contact information
Add contact info
[Search on Bing](https://www.bing.com/search?q=Harley+T.)
Lead IQNewAboutRelationshipExperience
Get insights about HarleyBETA
View personalized AI powered insights based on Harley’s profile and activity. [Learn more](https://www.linkedin.com/help/sales-navigator/answer/a6841315)
Generate Lead IQ
About
I am CTO at Trust Provenance, building infrastructure that lets supply chain clai … Show more
Relationship
You and Harley don’t share anything in common on LinkedIn. Search for leads at Trust Provenance instead.
[Search leads](https://www.linkedin.com/sales/search/people?_ntb=YwvZ%2B2iUQImYcL8x23xmsg%3D%3D&query=\(filters%3AList\(\(type%3ACURRENT_COMPANY%2Cvalues%3AList\(\(id%3A18855440%2CselectionType%3AINCLUDED\)\)\)\)\))
Harley’s experience
Harley has worked for 2 different companies over their professional career
Chief Technology Officer
[Trust Provenance](https://www.linkedin.com/sales/company/18855440)
May 2021–Present 5 yrs 4 mos
Adelaide, South Australia, Australia
Data Engineer
[Boeing](https://www.linkedin.com/sales/company/1384)
Nov 2018–Apr 2021 2 yrs 6 mos
Adelaide, South Australia, Australia
In November 2018 I had the pleasure to begin employment at Boeing Defence Australia within their Data Analytics capability. Here I conducted a significant refactoring of Boeing Maintenance Workflow Analytics (BMWA), to improve maintainability and enable future growth of the product. This body of work resulted in more customer engagements within the business, and I was awarded a Boeing Wirraway Award along with my teamma … Show more
Education
[University of Adelaide](https://www.linkedin.com/school/uniofadelaide/)
Bachelor of Computer Science (Advanced, Major in Data Science) Computer Science
2016 – 2020
Interests
[Boeing4,168,706 followers](https://www.linkedin.com/sales/company/1384)
[Google42,341,408 followers](https://www.linkedin.com/sales/company/1441)
[PepsiCo10,333,320 followers](https://www.linkedin.com/sales/company/1431)
[Australian Trade and Investment Commission (Austrade)205,534 followers](https://www.linkedin.com/sales/company/7867)
[Australian Department of Foreign Affairs and Trade165,010 followers](https://www.linkedin.com/sales/company/8253)
[University of Adelaide208,170 followers](https://www.linkedin.com/school/uniofadelaide/)
See all interests
Featured skills and endorsements
Data Analysis
1 endorsement
Applied Machine Learning
1 endorsement
Agile Application Development
1 endorsement
Unit Testing
1 endorsement
Integration Testing
1 endorsement
Docker
1 endorsement
JavaScript
1 endorsement
HTML
1 endorsement
CSS
1 endorsement
Show all skills
Lead actions panel
Lists (0)
Save
Add to a list to help organize leads and get alerts
Notes (0)
Add
Add notes to remember key details about Harley
Timeline
Your past history with Harley and key events
You have no previous activity with Harley
Save Harley to get alerts and stay informed of changes and updates
0 notifications total
Chat with us
Trust Provenance has been saved`;

  // 1. Process Raw Text
  const result = await processLeadContent(rawContent);
  
  // 2. Create Lead Record in Database
  const saved = await createLead(result);
  const leadId = saved._id.toString();

  // 3. Enrich Lead (Resolving company website and crawling for email)
  await enrichLead(leadId);

  // 4. Retrieve Updated Lead Record
  const finalLead = await Lead.findById(leadId);

  return jsonOk({
    parsedCompany: result.lead.currentCompany,
    enrichedWebsite: finalLead?.currentCompanyWebsite,
    enrichedEmail: finalLead?.email,
    emailsList: finalLead?.emails,
    enrichmentStatus: finalLead?.enrichmentStatus,
    fullRecord: finalLead
  });
}
